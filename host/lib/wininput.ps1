# Quest Mirror - Windows helper.
# Reads one command per line on stdin:
#   monitors                 -> prints one JSON line describing every DXGI output (same numbering ffmpeg ddagrab uses)
#   move X Y                 -> cursor to virtual-desktop pixel X,Y
#   down l|r|m / up l|r|m    -> mouse buttons
#   wheel N / hwheel N       -> wheel, N in 1/120 notch units
#   key VK 1|0 [ext]         -> virtual-key down (1) or up (0); "ext" marks an extended key
#   text BASE64              -> types UTF-8 text as Unicode key events
#   front BASE64             -> brings the first visible window whose title starts with that text to the front (prints True/False)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class QMInput {
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION u; }

    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

    public static void Init() {
        // Per-monitor DPI aware v2, so coordinates are real pixels (matching DXGI desktop coordinates).
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
    }

    static void Send(INPUT i) { SendInput(1, new INPUT[] { i }, Marshal.SizeOf(typeof(INPUT))); }

    static INPUT Mouse(uint flags, uint data) {
        INPUT i = new INPUT(); i.type = 0; i.u.mi.dwFlags = flags; i.u.mi.mouseData = data; return i;
    }

    public static void Move(int x, int y) { SetCursorPos(x, y); }

    public static void Button(string b, bool down) {
        uint f;
        if (b == "r") f = down ? 0x0008u : 0x0010u;
        else if (b == "m") f = down ? 0x0020u : 0x0040u;
        else f = down ? 0x0002u : 0x0004u;
        Send(Mouse(f, 0));
    }

    public static void Wheel(int amount, bool horizontal) { Send(Mouse(horizontal ? 0x1000u : 0x0800u, unchecked((uint)amount))); }

    public static void Key(ushort vk, bool down, bool extended) {
        INPUT i = new INPUT(); i.type = 1; i.u.ki.wVk = vk;
        i.u.ki.dwFlags = (down ? 0u : 0x0002u) | (extended ? 0x0001u : 0u);
        Send(i);
    }

    public static bool Front(string title) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, l) => {
            if (!IsWindowVisible(h)) return true;
            StringBuilder sb = new StringBuilder(512);
            GetWindowText(h, sb, 512);
            if (!sb.ToString().StartsWith(title)) return true;
            found = h;
            return false;
        }, IntPtr.Zero);
        if (found == IntPtr.Zero) return false;
        if (IsIconic(found)) ShowWindow(found, 9);
        // Windows only lets the process that sent the last input pick the foreground window: send a
        // harmless key-up (F24) first, and borrow the current foreground thread's input state.
        Key(0x87, false, false);
        uint fg = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero), me = GetCurrentThreadId();
        bool attached = fg != 0 && fg != me && AttachThreadInput(me, fg, true);
        BringWindowToTop(found);
        bool ok = SetForegroundWindow(found);
        if (attached) AttachThreadInput(me, fg, false);
        return ok;
    }

    public static void Text(string s) {
        foreach (char c in s) {
            if (c == '\n' || c == '\r') { Key(0x0D, true, false); Key(0x0D, false, false); continue; }
            INPUT d = new INPUT(); d.type = 1; d.u.ki.wScan = c; d.u.ki.dwFlags = 0x0004;
            INPUT u = new INPUT(); u.type = 1; u.u.ki.wScan = c; u.u.ki.dwFlags = 0x0004 | 0x0002;
            SendInput(2, new INPUT[] { d, u }, Marshal.SizeOf(typeof(INPUT)));
        }
    }

    // ---------------- DXGI output enumeration (vtable order matters; unused slots are placeholders)
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DXGI_OUTPUT_DESC {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
        public RECT DesktopCoordinates; public int AttachedToDesktop; public int Rotation; public IntPtr Monitor;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DXGI_ADAPTER_DESC1 {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
        public uint VendorId, DeviceId, SubSysId, Revision;
        public UIntPtr DedicatedVideoMemory, DedicatedSystemMemory, SharedSystemMemory;
        public uint LuidLow; public int LuidHigh; public uint Flags;
    }

    [ComImport, Guid("ae02eedb-c735-4690-8d52-5a8dc20213aa"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDXGIOutput {
        void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
        [PreserveSig] int GetDesc(out DXGI_OUTPUT_DESC desc);
    }
    [ComImport, Guid("29038f61-3839-4626-91fd-086879011a05"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDXGIAdapter1 {
        void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
        [PreserveSig] int EnumOutputs(uint index, out IDXGIOutput output);
        void GetDesc(); void CheckInterfaceSupport();
        [PreserveSig] int GetDesc1(out DXGI_ADAPTER_DESC1 desc);
    }
    [ComImport, Guid("770aae78-f26f-4dba-a829-253c83d1b387"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDXGIFactory1 {
        void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
        void EnumAdapters(); void MakeWindowAssociation(); void GetWindowAssociation(); void CreateSwapChain(); void CreateSoftwareAdapter();
        [PreserveSig] int EnumAdapters1(uint index, out IDXGIAdapter1 adapter);
    }
    [DllImport("dxgi.dll")] static extern int CreateDXGIFactory1(ref Guid riid, out IntPtr factory);

    static string Esc(string s) { return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\""); }

    public static string Monitors() {
        Guid iid = new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
        IntPtr p;
        if (CreateDXGIFactory1(ref iid, out p) != 0) return "[]";
        IDXGIFactory1 f = (IDXGIFactory1)Marshal.GetObjectForIUnknown(p);
        Marshal.Release(p);
        StringBuilder sb = new StringBuilder("[");
        bool first = true;
        HashSet<string> seen = new HashSet<string>();
        for (uint a = 0; a < 16; a++) {
            IDXGIAdapter1 ad;
            if (f.EnumAdapters1(a, out ad) != 0) break;
            DXGI_ADAPTER_DESC1 ades;
            ad.GetDesc1(out ades);
            for (uint o = 0; o < 16; o++) {
                IDXGIOutput op;
                if (ad.EnumOutputs(o, out op) != 0) break;
                DXGI_OUTPUT_DESC d;
                op.GetDesc(out d);
                Marshal.ReleaseComObject(op);
                if (d.AttachedToDesktop == 0 || !seen.Add(d.DeviceName)) continue;
                RECT r = d.DesktopCoordinates;
                if (!first) sb.Append(",");
                first = false;
                sb.AppendFormat("{{\"adapter\":{0},\"output\":{1},\"device\":\"{2}\",\"gpu\":\"{3}\",\"x\":{4},\"y\":{5},\"w\":{6},\"h\":{7},\"rotation\":{8}}}",
                    a, o, Esc(d.DeviceName), Esc(ades.Description), r.left, r.top, r.right - r.left, r.bottom - r.top, d.Rotation);
            }
            Marshal.ReleaseComObject(ad);
        }
        Marshal.ReleaseComObject(f);
        return sb.Append("]").ToString();
    }
}
'@

[QMInput]::Init()
[Console]::Out.WriteLine('ready')
[Console]::Out.Flush()

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $p = $line.Trim().Split(' ')
    try {
        switch ($p[0]) {
            'monitors' { [Console]::Out.WriteLine([QMInput]::Monitors()); [Console]::Out.Flush() }
            'move'     { [QMInput]::Move([int]$p[1], [int]$p[2]) }
            'down'     { [QMInput]::Button($p[1], $true) }
            'up'       { [QMInput]::Button($p[1], $false) }
            'wheel'    { [QMInput]::Wheel([int]$p[1], $false) }
            'hwheel'   { [QMInput]::Wheel([int]$p[1], $true) }
            'key'      { [QMInput]::Key([uint16]$p[1], $p[2] -eq '1', $p.Length -gt 3 -and $p[3] -eq 'ext') }
            'text'     { [QMInput]::Text([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p[1]))) }
            'front'    { [Console]::Out.WriteLine([QMInput]::Front([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p[1])))); [Console]::Out.Flush() }
            'ping'     { [Console]::Out.WriteLine('pong'); [Console]::Out.Flush() }
        }
    } catch {
        [Console]::Error.WriteLine("helper: $($_.Exception.Message)")
    }
}
