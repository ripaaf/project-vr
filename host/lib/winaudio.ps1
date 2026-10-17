# Quest Mirror - captures what the PC is playing (WASAPI loopback of the default output device)
# and writes it to stdout as raw 16-bit little-endian stereo PCM at the device's mix rate.
# The first stderr line is "QMAUDIO rate=<hz> channels=2". Gaps (nothing playing) are filled
# with silence so the stream keeps a steady clock.
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

public static class QMAudio {
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }
    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient {
        [PreserveSig] int Initialize(int shareMode, int streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
        [PreserveSig] int GetBufferSize(out uint frames);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint padding);
        [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minPeriod);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr h);
        [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }
    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
        [PreserveSig] int ReleaseBuffer(uint frames);
        [PreserveSig] int GetNextPacketSize(out uint frames);
    }

    static void Check(int hr, string what) {
        if (hr < 0) throw new Exception(what + " failed: 0x" + hr.ToString("X8"));
    }

    enum Kind { Float32, Int16, Int24, Int32 }

    public static int Run() {
        IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
        IMMDevice dev;
        Check(en.GetDefaultAudioEndpoint(0 /* eRender */, 0 /* eConsole */, out dev), "GetDefaultAudioEndpoint");
        Guid iidClient = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
        object o;
        Check(dev.Activate(ref iidClient, 23 /* CLSCTX_ALL */, IntPtr.Zero, out o), "Activate");
        IAudioClient client = (IAudioClient)o;

        IntPtr fmt;
        Check(client.GetMixFormat(out fmt), "GetMixFormat");
        int tag = Marshal.ReadInt16(fmt, 0) & 0xFFFF;
        int channels = Marshal.ReadInt16(fmt, 2);
        int rate = Marshal.ReadInt32(fmt, 4);
        int blockAlign = Marshal.ReadInt16(fmt, 12);
        int bits = Marshal.ReadInt16(fmt, 14);
        bool isFloat = tag == 3;
        if (tag == 0xFFFE) {
            byte[] sub = new byte[16];
            Marshal.Copy(new IntPtr(fmt.ToInt64() + 24), sub, 0, 16);
            isFloat = new Guid(sub) == new Guid("00000003-0000-0010-8000-00aa00389b71");
        }
        Kind kind = isFloat ? Kind.Float32 : bits == 16 ? Kind.Int16 : bits == 24 && blockAlign == channels * 3 ? Kind.Int24 : Kind.Int32;

        // 100 ms shared-mode loopback buffer.
        Check(client.Initialize(0, 0x00020000 /* LOOPBACK */, 1000000, 0, fmt, IntPtr.Zero), "Initialize");
        Guid iidCapture = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");
        object c;
        Check(client.GetService(ref iidCapture, out c), "GetService");
        IAudioCaptureClient cap = (IAudioCaptureClient)c;
        Marshal.FreeCoTaskMem(fmt);

        Console.Error.WriteLine("QMAUDIO rate=" + rate + " channels=2 source=" + channels + "ch " + kind);
        Console.Error.Flush();

        Stream stdout = Console.OpenStandardOutput();
        byte[] raw = new byte[rate * blockAlign];
        short[] pcm = new short[rate * 2];
        byte[] outBytes = new byte[rate * 4];
        Check(client.Start(), "Start");
        Stopwatch clock = Stopwatch.StartNew();
        long framesOut = 0;
        bool debug = Environment.GetEnvironmentVariable("QM_AUDIO_DEBUG") == "1";
        int dbgPackets = 0, dbgSilent = 0, dbgPeak = 0; long dbgFill = 0, dbgAt = 0;

        while (true) {
            bool got = false;
            uint packet;
            Check(cap.GetNextPacketSize(out packet), "GetNextPacketSize");
            while (packet > 0) {
                IntPtr data; uint frames, flags; ulong p1, p2;
                Check(cap.GetBuffer(out data, out frames, out flags, out p1, out p2), "GetBuffer");
                int n = (int)frames;
                if (n * blockAlign > raw.Length) { raw = new byte[n * blockAlign]; pcm = new short[n * 2]; outBytes = new byte[n * 4]; }
                dbgPackets++;
                if ((flags & 0x2) != 0) { Array.Clear(pcm, 0, n * 2); dbgSilent++; } // AUDCLNT_BUFFERFLAGS_SILENT
                else {
                    Marshal.Copy(data, raw, 0, n * blockAlign);
                    Convert(raw, n, channels, blockAlign, kind, pcm);
                    if (debug) for (int i = 0; i < n * 2; i++) { int a = Math.Abs((int)pcm[i]); if (a > dbgPeak) dbgPeak = a; }
                }
                Check(cap.ReleaseBuffer(frames), "ReleaseBuffer");
                Buffer.BlockCopy(pcm, 0, outBytes, 0, n * 4);
                stdout.Write(outBytes, 0, n * 4);
                framesOut += n;
                got = true;
                Check(cap.GetNextPacketSize(out packet), "GetNextPacketSize");
            }
            // Nothing is playing: Windows sends no packets at all, so fill the gap with silence.
            long due = clock.ElapsedTicks * rate / Stopwatch.Frequency;
            if (!got && due - framesOut > rate / 30) {
                int fill = (int)Math.Min(due - framesOut - rate / 100, rate / 2);
                if (fill > 0) {
                    if (fill * 4 > outBytes.Length) outBytes = new byte[fill * 4];
                    Array.Clear(outBytes, 0, fill * 4);
                    stdout.Write(outBytes, 0, fill * 4);
                    framesOut += fill;
                    dbgFill += fill;
                }
            }
            if (debug && clock.ElapsedMilliseconds - dbgAt >= 1000) {
                dbgAt = clock.ElapsedMilliseconds;
                Console.Error.WriteLine("QMAUDIO debug packets=" + dbgPackets + " silentFlag=" + dbgSilent + " fillFrames=" + dbgFill + " peak=" + dbgPeak);
                dbgPackets = dbgSilent = dbgPeak = 0; dbgFill = 0;
            }
            if (framesOut > due + rate) framesOut = due; // re-sync after a long burst
            if (got) stdout.Flush();
            Thread.Sleep(5);
        }
    }

    static float Sample(byte[] raw, int offset, Kind kind) {
        switch (kind) {
            case Kind.Float32: return BitConverter.ToSingle(raw, offset);
            case Kind.Int16: return BitConverter.ToInt16(raw, offset) / 32768f;
            case Kind.Int24: return ((raw[offset] << 8 | raw[offset + 1] << 16 | raw[offset + 2] << 24) >> 8) / 8388608f;
            default: return BitConverter.ToInt32(raw, offset) / 2147483648f;
        }
    }

    /** Any layout -> stereo 16-bit. Surround is folded down (centre and rear channels into left/right). */
    static void Convert(byte[] raw, int frames, int ch, int blockAlign, Kind kind, short[] pcm) {
        int bps = blockAlign / ch;
        for (int f = 0; f < frames; f++) {
            int b = f * blockAlign;
            float l = Sample(raw, b, kind);
            float r = ch > 1 ? Sample(raw, b + bps, kind) : l;
            if (ch >= 3) { float cc = Sample(raw, b + 2 * bps, kind) * 0.707f; l += cc; r += cc; }
            if (ch >= 6) { l += Sample(raw, b + 4 * bps, kind) * 0.5f; r += Sample(raw, b + 5 * bps, kind) * 0.5f; }
            if (ch >= 8) { l += Sample(raw, b + 6 * bps, kind) * 0.5f; r += Sample(raw, b + 7 * bps, kind) * 0.5f; }
            pcm[f * 2] = Clip(l);
            pcm[f * 2 + 1] = Clip(r);
        }
    }

    static short Clip(float v) {
        if (v > 1f) v = 1f; else if (v < -1f) v = -1f;
        return (short)(v * 32767f);
    }
}
'@

try {
    exit [QMAudio]::Run()
} catch {
    [Console]::Error.WriteLine("QMAUDIO error: $($_.Exception.InnerException.Message) $($_.Exception.Message)")
    exit 1
}
