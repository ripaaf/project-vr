package com.questmirror.app;

import android.media.MediaCodec;
import android.media.MediaFormat;
import android.os.Build;
import android.util.Log;
import android.view.Surface;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.util.Arrays;

/**
 * Pulls a raw H.264 stream of one PC monitor from the host and decodes it straight onto a
 * Surface with the headset's hardware decoder. The host puts an access-unit delimiter
 * before every frame, which is all we need to cut the byte stream into frames.
 */
final class PcStream {
    private static final String TAG = "QuestMirror";

    interface Listener {
        void onState(String message, boolean connected);

        void onVideoSize(int width, int height);

        /** The PC refused us for good (unlinked / sharing off). No more retries. */
        void onFatal(String message);
    }

    /** HTTP 401/403 from the PC: retrying won't help. */
    static final class Refused extends IOException {
        Refused(String m) {
            super(m);
        }
    }

    private final String[] bases;
    private final String path;
    private int baseIdx;
    private final String token;
    private final Surface surface;
    private final Listener listener;
    private volatile boolean running;
    private Thread netThread;
    private volatile HttpURLConnection conn;
    private volatile int framesDecoded;
    private int lastFrames;
    private long lastFpsAt;

    /** bases: ways to reach the PC, best first (Wi-Fi addresses, then the ADB tunnel). */
    PcStream(String[] bases, String path, String token, Surface surface, Listener listener) {
        this.bases = bases;
        this.path = path;
        this.token = token;
        this.surface = surface;
        this.listener = listener;
    }

    void start() {
        running = true;
        netThread = new Thread(this::loop, "pc-stream");
        netThread.start();
    }

    void stop() {
        running = false;
        HttpURLConnection c = conn;
        if (c != null) c.disconnect();
        if (netThread != null) netThread.interrupt();
    }

    /** Frames per second since the last call. */
    int fps() {
        long now = System.currentTimeMillis();
        int f = framesDecoded;
        int fps = lastFpsAt == 0 ? 0 : Math.round((f - lastFrames) * 1000f / Math.max(1, now - lastFpsAt));
        lastFrames = f;
        lastFpsAt = now;
        return fps;
    }

    private void loop() {
        int attempt = 0;
        while (running) {
            MediaCodec codec = null;
            Thread out = null;
            try {
                listener.onState(attempt == 0 ? "Connecting to your PC…" : "Reconnecting…", false);
                String base = bases[baseIdx % bases.length];
                HttpURLConnection c = (HttpURLConnection) new URL(base + path).openConnection();
                conn = c;
                c.setConnectTimeout(3000);
                c.setReadTimeout(8000);
                if (token != null) c.setRequestProperty("X-QM-Token", token);
                int code = c.getResponseCode();
                if (code != 200) {
                    String msg = "PC said " + code;
                    try {
                        InputStream es = c.getErrorStream();
                        if (es != null) msg = new org.json.JSONObject(HostClient.readAll(es)).optString("error", msg);
                    } catch (Exception ignored) {
                    }
                    if (code == 401 || code == 403) throw new Refused(msg);
                    throw new IOException(msg);
                }
                Log.i(TAG, "pc stream via " + base);
                int w = parse(c.getHeaderField("X-Width"), 1920);
                int h = parse(c.getHeaderField("X-Height"), 1080);
                listener.onVideoSize(w, h);
                InputStream in = c.getInputStream();

                byte[] acc = new byte[1 << 20];
                int len = 0;
                int frameStart = -1; // offset of the current frame's AUD start code
                boolean configured = false;
                byte[] buf = new byte[256 * 1024];
                while (running) {
                    int n = in.read(buf);
                    if (n < 0) throw new IOException("PC stopped the stream");
                    if (len + n > acc.length) acc = Arrays.copyOf(acc, Math.max(acc.length * 2, len + n));
                    System.arraycopy(buf, 0, acc, len, n);
                    int scanFrom = Math.max(0, len - 4);
                    len += n;

                    int pos = scanFrom;
                    while (true) {
                        int aud = findAud(acc, pos, len);
                        if (aud < 0) break;
                        if (frameStart >= 0 && aud > frameStart) {
                            if (!configured) {
                                codec = configure(acc, frameStart, aud, w, h);
                                if (codec != null) {
                                    configured = true;
                                    final MediaCodec cc = codec;
                                    out = new Thread(() -> drain(cc), "pc-decode-out");
                                    out.start();
                                    listener.onState(null, true);
                                    attempt = 0;
                                }
                            }
                            if (configured) queue(codec, acc, frameStart, aud - frameStart);
                        }
                        frameStart = aud;
                        pos = aud + 4;
                    }
                    // Drop consumed bytes so the buffer doesn't grow.
                    if (frameStart > 0) {
                        System.arraycopy(acc, frameStart, acc, 0, len - frameStart);
                        len -= frameStart;
                        frameStart = 0;
                    } else if (frameStart < 0 && len > (1 << 22)) {
                        len = 0;
                    }
                }
            } catch (Refused e) {
                running = false;
                listener.onFatal(e.getMessage());
            } catch (Exception e) {
                if (running) {
                    Log.w(TAG, "pc stream: " + e);
                    // Try the next way of reaching the PC (e.g. its Wi-Fi address changed).
                    baseIdx++;
                    listener.onState(e.getMessage() == null ? "Connection lost — retrying" : e.getMessage(), false);
                }
            } finally {
                HttpURLConnection c = conn;
                if (c != null) c.disconnect();
                if (codec != null) {
                    try {
                        codec.stop();
                    } catch (Exception ignored) {
                    }
                    codec.release();
                }
                if (out != null) out.interrupt();
            }
            attempt++;
            if (running) {
                try {
                    Thread.sleep(Math.min(3000, 600L * attempt));
                } catch (InterruptedException ignored) {
                }
            }
        }
    }

    private static int parse(String s, int def) {
        try {
            return Integer.parseInt(s);
        } catch (Exception e) {
            return def;
        }
    }

    /** Index of the next "00 00 01 09" (AUD), including a leading zero of a 4-byte start code. */
    private static int findAud(byte[] a, int from, int to) {
        for (int i = from; i + 3 < to; i++) {
            if (a[i + 2] == 1 && a[i] == 0 && a[i + 1] == 0 && (a[i + 3] & 0x1f) == 9) {
                return (i > 0 && a[i - 1] == 0) ? i - 1 : i;
            }
        }
        return -1;
    }

    /** Builds the decoder from the SPS/PPS found in the first frame; returns null until one arrives. */
    private MediaCodec configure(byte[] a, int start, int end, int w, int h) throws IOException {
        byte[] sps = null, pps = null;
        int i = start;
        while (i < end) {
            int sc = nextStartCode(a, i, end);
            if (sc < 0) break;
            int nalStart = sc + 3;
            int next = nextStartCode(a, nalStart, end);
            int nalEnd = next < 0 ? end : (a[next - 1] == 0 ? next - 1 : next);
            int type = a[nalStart] & 0x1f;
            if (type == 7) sps = withStartCode(a, nalStart, nalEnd);
            if (type == 8) pps = withStartCode(a, nalStart, nalEnd);
            i = next < 0 ? end : next;
        }
        if (sps == null || pps == null) return null;

        MediaFormat f = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, w, h);
        f.setByteBuffer("csd-0", ByteBuffer.wrap(sps));
        f.setByteBuffer("csd-1", ByteBuffer.wrap(pps));
        f.setInteger(MediaFormat.KEY_PRIORITY, 0); // real-time
        f.setInteger("vendor.qti-ext-dec-low-latency.enable", 1);
        f.setInteger("vendor.qti-ext-dec-picture-order.enable", 1);
        if (Build.VERSION.SDK_INT >= 30) f.setInteger(MediaFormat.KEY_LOW_LATENCY, 1);
        MediaCodec codec = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_VIDEO_AVC);
        try {
            codec.configure(f, surface, null, 0);
        } catch (Exception e) {
            // Some decoders reject the vendor keys: retry with a plain format.
            codec.release();
            codec = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_VIDEO_AVC);
            MediaFormat plain = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, w, h);
            plain.setByteBuffer("csd-0", ByteBuffer.wrap(sps));
            plain.setByteBuffer("csd-1", ByteBuffer.wrap(pps));
            codec.configure(plain, surface, null, 0);
        }
        codec.start();
        return codec;
    }

    private static int nextStartCode(byte[] a, int from, int to) {
        for (int i = from; i + 2 < to; i++) if (a[i] == 0 && a[i + 1] == 0 && a[i + 2] == 1) return i;
        return -1;
    }

    private static byte[] withStartCode(byte[] a, int from, int to) {
        byte[] out = new byte[4 + (to - from)];
        out[3] = 1;
        System.arraycopy(a, from, out, 4, to - from);
        return out;
    }

    private void queue(MediaCodec codec, byte[] a, int off, int n) {
        int idx = codec.dequeueInputBuffer(20000);
        if (idx < 0) return; // decoder is behind: drop this frame rather than add latency
        ByteBuffer b = codec.getInputBuffer(idx);
        if (b == null || b.capacity() < n) {
            codec.queueInputBuffer(idx, 0, 0, 0, 0);
            return;
        }
        b.clear();
        b.put(a, off, n);
        codec.queueInputBuffer(idx, 0, n, System.nanoTime() / 1000, 0);
    }

    private void drain(MediaCodec codec) {
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        while (running && !Thread.currentThread().isInterrupted()) {
            try {
                int idx = codec.dequeueOutputBuffer(info, 20000);
                if (idx >= 0) {
                    codec.releaseOutputBuffer(idx, true); // show immediately
                    framesDecoded++;
                }
            } catch (IllegalStateException e) {
                return; // codec was stopped
            }
        }
    }
}
