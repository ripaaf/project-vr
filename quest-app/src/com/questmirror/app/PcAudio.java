package com.questmirror.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Plays the PC's sound (raw 16-bit stereo PCM from GET /api/pc/audio) while at least one PC
 * screen window is open. One shared stream no matter how many screen windows there are.
 */
final class PcAudio {
    private static final String TAG = "QuestMirror";
    private static final float MAX_QUEUE_SEC = 0.15f; // drop audio rather than fall further behind than this
    private static PcAudio instance;

    interface Listener {
        void onAudioState(boolean muted, boolean playing);
    }

    private final SharedPreferences prefs;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();
    private int refs;
    private String[] bases;
    private String token;
    private int baseIdx;
    private Thread thread;
    private volatile boolean running;
    private volatile boolean playing;
    private volatile HttpURLConnection conn;

    static synchronized PcAudio get(Context c) {
        if (instance == null) instance = new PcAudio(c.getApplicationContext());
        return instance;
    }

    private PcAudio(Context c) {
        prefs = c.getSharedPreferences("questmirror", Context.MODE_PRIVATE);
    }

    boolean muted() {
        return prefs.getBoolean("pcAudioMuted", false);
    }

    boolean playing() {
        return playing;
    }

    void addListener(Listener l) {
        listeners.add(l);
    }

    void removeListener(Listener l) {
        listeners.remove(l);
    }

    private void notifyState() {
        final boolean m = muted(), p = playing;
        ui.post(() -> {
            for (Listener l : listeners) l.onAudioState(m, p);
        });
    }

    synchronized void acquire(String[] bases, String token) {
        refs++;
        this.bases = bases;
        this.token = token;
        if (!muted()) startLocked();
    }

    synchronized void release() {
        refs = Math.max(0, refs - 1);
        if (refs == 0) stopLocked();
    }

    synchronized void setMuted(boolean m) {
        prefs.edit().putBoolean("pcAudioMuted", m).apply();
        if (m) stopLocked();
        else if (refs > 0) startLocked();
        notifyState();
    }

    private void startLocked() {
        if (running || bases == null || bases.length == 0) return;
        running = true;
        thread = new Thread(this::loop, "pc-audio");
        thread.start();
    }

    private void stopLocked() {
        running = false;
        HttpURLConnection c = conn;
        if (c != null) c.disconnect();
        if (thread != null) thread.interrupt();
        thread = null;
    }

    private void loop() {
        int attempt = 0;
        while (running) {
            AudioTrack track = null;
            try {
                String base = bases[baseIdx % bases.length];
                HttpURLConnection c = (HttpURLConnection) new URL(base + "/api/pc/audio").openConnection();
                conn = c;
                c.setConnectTimeout(3000);
                c.setReadTimeout(20000); // the helper needs a few seconds to start on the PC
                if (token != null) c.setRequestProperty("X-QM-Token", token);
                int code = c.getResponseCode();
                if (code == 401 || code == 403) {
                    Log.w(TAG, "pc audio refused (unlinked?)");
                    running = false;
                    break;
                }
                if (code != 200) throw new java.io.IOException("PC audio: HTTP " + code);
                int rate = Integer.parseInt(c.getHeaderField("X-Rate") == null ? "48000" : c.getHeaderField("X-Rate"));
                InputStream in = c.getInputStream();
                c.setReadTimeout(5000);

                int minBuf = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT);
                track = new AudioTrack.Builder()
                        .setAudioAttributes(new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_MEDIA)
                                .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
                                .build())
                        .setAudioFormat(new AudioFormat.Builder()
                                .setSampleRate(rate)
                                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                                .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                                .build())
                        .setBufferSizeInBytes(Math.max(minBuf * 2, rate * 4 / 8))
                        .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
                        .setTransferMode(AudioTrack.MODE_STREAM)
                        .build();
                track.play();
                playing = true;
                attempt = 0;
                notifyState();
                Log.i(TAG, "pc audio playing at " + rate + " Hz");

                byte[] buf = new byte[rate * 4 / 20 + 4]; // ~50 ms reads
                int carry = 0;
                long written = 0; // frames handed to the track
                int maxQueue = Math.round(rate * MAX_QUEUE_SEC);
                while (running) {
                    int n = in.read(buf, carry, buf.length - carry);
                    if (n < 0) throw new java.io.IOException("PC audio stream ended");
                    int total = carry + n;
                    int usable = total - (total % 4); // whole stereo frames only
                    long queued = written - (track.getPlaybackHeadPosition() & 0xFFFFFFFFL);
                    if (queued < maxQueue) {
                        int w = track.write(buf, 0, usable, AudioTrack.WRITE_NON_BLOCKING);
                        if (w > 0) written += w / 4;
                    }
                    carry = total - usable;
                    if (carry > 0) System.arraycopy(buf, usable, buf, 0, carry);
                }
            } catch (Exception e) {
                if (running) {
                    Log.w(TAG, "pc audio: " + e);
                    baseIdx++; // try the next way of reaching the PC
                }
            } finally {
                playing = false;
                if (track != null) {
                    try {
                        track.stop();
                    } catch (Exception ignored) {
                    }
                    track.release();
                }
                HttpURLConnection c = conn;
                if (c != null) c.disconnect();
                notifyState();
            }
            attempt++;
            if (running) {
                try {
                    Thread.sleep(Math.min(5000, 1000L * attempt));
                } catch (InterruptedException ignored) {
                }
            }
        }
    }
}
