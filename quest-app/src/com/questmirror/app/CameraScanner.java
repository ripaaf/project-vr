package com.questmirror.app;

import android.content.Context;
import android.graphics.ImageFormat;
import android.graphics.SurfaceTexture;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.Image;
import android.media.ImageReader;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.util.Log;
import android.util.Size;
import android.view.Surface;
import android.view.TextureView;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Reads QR codes through the headset's own passthrough camera (Horizon OS Passthrough
 * Camera API = plain Camera2 + horizonos.permission.HEADSET_CAMERA). Just look at the code.
 */
final class CameraScanner {
    private static final String TAG = "QuestMirror";

    interface Listener {
        void onCode(String text);

        void onScanError(String message);
    }

    private final Context ctx;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService decoder = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean();
    private HandlerThread thread;
    private Handler bg;
    private CameraDevice camera;
    private CameraCaptureSession session;
    private ImageReader reader;
    private TextureView preview;
    private volatile boolean running;
    private volatile boolean opening; // openCamera() issued, callback not delivered yet
    private volatile int framesSeen;

    CameraScanner(Context ctx, Listener listener) {
        this.ctx = ctx.getApplicationContext();
        this.listener = listener;
    }

    boolean running() {
        return running;
    }

    int framesSeen() {
        return framesSeen;
    }

    /** Prefer Meta's left passthrough camera (camera_source 0, position 0). */
    private static String pickCamera(CameraManager cm) throws CameraAccessException {
        CameraCharacteristics.Key<Byte> source = new CameraCharacteristics.Key<>("com.meta.extra_metadata.camera_source", Byte.class);
        CameraCharacteristics.Key<Byte> position = new CameraCharacteristics.Key<>("com.meta.extra_metadata.position", Byte.class);
        String first = null, passthrough = null;
        for (String id : cm.getCameraIdList()) {
            if (first == null) first = id;
            CameraCharacteristics c = cm.getCameraCharacteristics(id);
            Byte s = null, p = null;
            try {
                s = c.get(source);
                p = c.get(position);
            } catch (Exception ignored) {
            }
            if (s != null && s == 0) {
                if (p != null && p == 0) return id;
                if (passthrough == null) passthrough = id;
            }
        }
        return passthrough != null ? passthrough : first;
    }

    private static Size pickSize(CameraManager cm, String id) throws CameraAccessException {
        StreamConfigurationMap map = cm.getCameraCharacteristics(id).get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
        Size best = new Size(1280, 960);
        if (map == null) return best;
        Size[] sizes = map.getOutputSizes(ImageFormat.YUV_420_888);
        if (sizes == null || sizes.length == 0) return best;
        best = sizes[0];
        int bestScore = Integer.MAX_VALUE;
        for (Size s : sizes) {
            // Around 1280 px wide is plenty for a full-screen code and keeps decoding fast.
            int score = Math.abs(s.getWidth() - 1280) + (s.getWidth() > 1600 ? 10000 : 0);
            if (score < bestScore) {
                bestScore = score;
                best = s;
            }
        }
        return best;
    }

    @SuppressWarnings("MissingPermission")
    void start(TextureView previewView) {
        if (running) return;
        running = true;
        preview = previewView;
        thread = new HandlerThread("qr-camera");
        thread.start();
        bg = new Handler(thread.getLooper());
        try {
            CameraManager cm = (CameraManager) ctx.getSystemService(Context.CAMERA_SERVICE);
            String id = pickCamera(cm);
            if (id == null) throw new IllegalStateException("No camera available");
            Size size = pickSize(cm, id);
            Log.i(TAG, "qr camera " + id + " at " + size);
            reader = ImageReader.newInstance(size.getWidth(), size.getHeight(), ImageFormat.YUV_420_888, 2);
            reader.setOnImageAvailableListener(this::onFrame, bg);
            final HandlerThread t = thread;
            opening = true;
            cm.openCamera(id, new CameraDevice.StateCallback() {
                @Override
                public void onOpened(CameraDevice c) {
                    opening = false;
                    if (!running) { // stopped while the camera was still opening
                        c.close();
                        t.quitSafely();
                        return;
                    }
                    camera = c;
                    startSession(size, true);
                }

                @Override
                public void onDisconnected(CameraDevice c) {
                    opening = false;
                    c.close();
                    if (running) fail("Camera was taken by another app");
                    else t.quitSafely();
                }

                @Override
                public void onError(CameraDevice c, int error) {
                    opening = false;
                    c.close();
                    if (running) fail("Camera error " + error);
                    else t.quitSafely();
                }
            }, bg);
        } catch (Exception e) {
            fail(e.getMessage() == null ? e.toString() : e.getMessage());
        }
    }

    private void startSession(Size size, boolean withPreview) {
        try {
            List<Surface> targets = new ArrayList<>();
            targets.add(reader.getSurface());
            Surface previewSurface = null;
            if (withPreview && preview != null && preview.isAvailable()) {
                SurfaceTexture st = preview.getSurfaceTexture();
                st.setDefaultBufferSize(size.getWidth(), size.getHeight());
                previewSurface = new Surface(st);
                targets.add(previewSurface);
            }
            final Surface ps = previewSurface;
            camera.createCaptureSession(targets, new CameraCaptureSession.StateCallback() {
                @Override
                public void onConfigured(CameraCaptureSession s) {
                    if (!running || camera == null) {
                        s.close();
                        return;
                    }
                    session = s;
                    try {
                        CaptureRequest.Builder b = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
                        b.addTarget(reader.getSurface());
                        if (ps != null) b.addTarget(ps);
                        s.setRepeatingRequest(b.build(), null, bg);
                    } catch (Exception e) {
                        fail(e.toString());
                    }
                }

                @Override
                public void onConfigureFailed(CameraCaptureSession s) {
                    if (!running) return;
                    if (ps != null) startSession(size, false); // preview + reader not supported together: scan without preview
                    else fail("Camera could not start");
                }
            }, bg);
        } catch (Exception e) {
            if (withPreview) startSession(size, false);
            else fail(e.toString());
        }
    }

    private void onFrame(ImageReader r) {
        Image img = r.acquireLatestImage();
        if (img == null) return;
        if (++framesSeen % 90 == 1) Log.i(TAG, "qr camera frames=" + framesSeen + " " + img.getWidth() + "x" + img.getHeight());
        if (!running || busy.get()) {
            img.close();
            return;
        }
        // Copy the luminance plane, then decode off the camera thread.
        int w = img.getWidth(), h = img.getHeight();
        Image.Plane y = img.getPlanes()[0];
        ByteBuffer buf = y.getBuffer();
        int rowStride = y.getRowStride(), pixStride = y.getPixelStride();
        byte[] gray = new byte[w * h];
        if (pixStride == 1 && rowStride == w) {
            buf.get(gray, 0, Math.min(gray.length, buf.remaining()));
        } else {
            byte[] row = new byte[rowStride];
            for (int j = 0; j < h; j++) {
                buf.position(j * rowStride);
                buf.get(row, 0, Math.min(rowStride, buf.remaining()));
                for (int i = 0; i < w; i++) gray[j * w + i] = row[i * pixStride];
            }
        }
        img.close();
        busy.set(true);
        final boolean dump = framesSeen % 120 == 0 && dumpEnabled();
        decoder.execute(() -> {
            try {
                if (dump) dumpFrame(gray, w, h);
                String text = QrDecoder.decode(gray, w, h);
                if (text != null && running) {
                    Log.i(TAG, "qr decoded: " + text);
                    main.post(() -> listener.onCode(text));
                }
            } catch (Throwable t) {
                Log.w(TAG, "qr decode failed", t);
            } finally {
                busy.set(false);
            }
        });
    }

    /** Debug aid: create files/qr-dump on the headset and the scanner saves what it sees as qr-last.pgm. */
    private boolean dumpEnabled() {
        java.io.File dir = ctx.getExternalFilesDir(null);
        return dir != null && new java.io.File(dir, "qr-dump").exists();
    }

    private void dumpFrame(byte[] gray, int w, int h) {
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(new java.io.File(ctx.getExternalFilesDir(null), "qr-last.pgm"))) {
            out.write(("P5\n" + w + " " + h + "\n255\n").getBytes(java.nio.charset.StandardCharsets.US_ASCII));
            out.write(gray);
        } catch (Exception e) {
            Log.w(TAG, "dump failed: " + e);
        }
    }

    private void fail(String message) {
        Log.w(TAG, "qr camera: " + message);
        stop();
        main.post(() -> listener.onScanError(message));
    }

    /** Closes everything on the camera thread; if the camera is still opening, its callback finishes the job. */
    void stop() {
        running = false;
        final Handler h = bg;
        final HandlerThread t = thread;
        if (h == null || t == null) return;
        h.post(() -> {
            try {
                if (session != null) session.close();
            } catch (Exception ignored) {
            }
            try {
                if (camera != null) camera.close();
            } catch (Exception ignored) {
            }
            try {
                if (reader != null) reader.close();
            } catch (Exception ignored) {
            }
            session = null;
            camera = null;
            reader = null;
            if (!opening) t.quitSafely();
        });
    }
}
