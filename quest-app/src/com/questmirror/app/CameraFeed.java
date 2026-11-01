package com.questmirror.app;

import android.content.Context;
import android.graphics.ImageFormat;
import android.graphics.Rect;
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
import android.os.SystemClock;
import android.util.Size;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Collections;

/**
 * A small live picture from the left passthrough camera, for colouring scans: the space asks for
 * the newest frame several times a second while it scans; with nobody asking for a few seconds the
 * camera closes again. {@link #info()} tells the space where that camera sits on the headset and
 * how it sees (focal length, centre), so a 3D point can be found in the picture.
 */
final class CameraFeed {
    private static CameraFeed instance;

    private final Context ctx;
    private HandlerThread thread;
    private Handler bg;
    private CameraDevice camera;
    private CameraCaptureSession session;
    private ImageReader reader;
    private volatile boolean running;
    private volatile byte[] jpeg;
    private volatile long jpegAt;
    private volatile long capturedAt; // uptime ms when the newest picture was taken
    private boolean realtimeClock; // the camera's timestamps use elapsedRealtime
    private volatile long askedAt;
    private volatile String error;
    private long encodedAt;
    private String id;
    private Size size;

    private CameraFeed(Context c) {
        ctx = c.getApplicationContext();
    }

    static synchronized CameraFeed get(Context c) {
        if (instance == null) instance = new CameraFeed(c);
        return instance;
    }

    /** Where the camera is and how it sees: intrinsics for the full sensor, its crop, the frame size, its pose. */
    synchronized JSONObject info() throws Exception {
        CameraManager cm = (CameraManager) ctx.getSystemService(Context.CAMERA_SERVICE);
        if (id == null) {
            id = CameraScanner.pickCamera(cm);
            size = pickSize(cm, id);
        }
        CameraCharacteristics c = cm.getCameraCharacteristics(id);
        JSONObject o = new JSONObject();
        o.put("id", id).put("w", size.getWidth()).put("h", size.getHeight());
        float[] k = c.get(CameraCharacteristics.LENS_INTRINSIC_CALIBRATION);
        float[] t = c.get(CameraCharacteristics.LENS_POSE_TRANSLATION);
        float[] q = c.get(CameraCharacteristics.LENS_POSE_ROTATION);
        Rect active = c.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE);
        Integer ref = c.get(CameraCharacteristics.LENS_POSE_REFERENCE);
        Integer src = c.get(CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE);
        realtimeClock = src != null && src == CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME;
        if (k != null) o.put("k", arr(k));
        if (t != null) o.put("t", arr(t));
        if (q != null) o.put("q", arr(q));
        if (active != null) o.put("sensor", new JSONArray().put(active.width()).put(active.height()));
        if (ref != null) o.put("ref", ref);
        StreamConfigurationMap map = c.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
        JSONArray sizes = new JSONArray();
        if (map != null) for (Size z : map.getOutputSizes(ImageFormat.YUV_420_888)) sizes.put(z.getWidth() + "x" + z.getHeight());
        o.put("sizes", sizes);
        return o;
    }

    private static JSONArray arr(float[] a) throws Exception {
        JSONArray j = new JSONArray();
        for (float f : a) j.put((double) f);
        return j;
    }

    /** The whole sensor (square on Quest 3) so every point the depth sees is also in the picture;
     *  a wide crop would cut the top and bottom off. Largest size with the sensor's shape, up to 1280. */
    private static Size pickSize(CameraManager cm, String id) throws Exception {
        StreamConfigurationMap map = cm.getCameraCharacteristics(id).get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
        Size best = new Size(640, 480);
        if (map == null) return best;
        Size[] sizes = map.getOutputSizes(ImageFormat.YUV_420_888);
        if (sizes == null || sizes.length == 0) return best;
        Rect act = cm.getCameraCharacteristics(id).get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE);
        double aspect = act != null ? act.width() / (double) act.height() : 4 / 3.0;
        int bestScore = Integer.MAX_VALUE;
        for (Size s : sizes) {
            int score = (int) (Math.abs(s.getWidth() / (double) s.getHeight() - aspect) * 10000) + Math.abs(1280 - s.getWidth()) + (s.getWidth() > 1280 ? 100000 : 0);
            if (score < bestScore) {
                bestScore = score;
                best = s;
            }
        }
        return best;
    }

    /** How old the newest picture is, in ms. */
    long ageMs() {
        return SystemClock.uptimeMillis() - capturedAt;
    }

    /** The newest frame (JPEG), opening the camera on first ask; null while it is still starting. */
    byte[] frame() throws Exception {
        askedAt = SystemClock.uptimeMillis();
        if (!running) start();
        if (error != null) {
            String e = error;
            stop();
            throw new IllegalStateException(e);
        }
        long until = askedAt + 1500;
        while ((jpeg == null || SystemClock.uptimeMillis() - jpegAt > 1000) && SystemClock.uptimeMillis() < until) Thread.sleep(30);
        return jpeg;
    }

    @SuppressWarnings("MissingPermission")
    private synchronized void start() throws Exception {
        if (running) return;
        info(); // picks the camera and size
        running = true;
        error = null;
        jpeg = null;
        thread = new HandlerThread("scan-camera");
        thread.start();
        bg = new Handler(thread.getLooper());
        reader = ImageReader.newInstance(size.getWidth(), size.getHeight(), ImageFormat.YUV_420_888, 3);
        reader.setOnImageAvailableListener(r -> {
            Image img = r.acquireLatestImage();
            if (img == null) return;
            try {
                long now = SystemClock.uptimeMillis();
                if (now - encodedAt >= 140) { // ~7 pictures a second is plenty for colour
                    encodedAt = now;
                    // how long ago the camera took it (its clock, when it is the same as ours)
                    long ago = realtimeClock ? (SystemClock.elapsedRealtimeNanos() - img.getTimestamp()) / 1000000L : 30;
                    jpeg = CameraShot.jpeg(img, null, 70);
                    jpegAt = now;
                    capturedAt = now - Math.max(0, Math.min(500, ago));
                }
            } finally {
                img.close();
            }
            if (SystemClock.uptimeMillis() - askedAt > 4000) bg.post(this::stop); // nobody is scanning any more
        }, bg);
        CameraManager cm = (CameraManager) ctx.getSystemService(Context.CAMERA_SERVICE);
        cm.openCamera(id, new CameraDevice.StateCallback() {
            @Override
            public void onOpened(CameraDevice c) {
                camera = c;
                try {
                    c.createCaptureSession(Collections.singletonList(reader.getSurface()), new CameraCaptureSession.StateCallback() {
                        @Override
                        public void onConfigured(CameraCaptureSession s) {
                            session = s;
                            try {
                                CaptureRequest.Builder b = c.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
                                b.addTarget(reader.getSurface());
                                s.setRepeatingRequest(b.build(), null, bg);
                            } catch (Exception e) {
                                error = e.toString();
                            }
                        }

                        @Override
                        public void onConfigureFailed(CameraCaptureSession s) {
                            error = "The camera could not start";
                        }
                    }, bg);
                } catch (Exception e) {
                    error = e.toString();
                }
            }

            @Override
            public void onDisconnected(CameraDevice c) {
                error = "The camera is busy with another app";
                c.close();
            }

            @Override
            public void onError(CameraDevice c, int code) {
                error = "The camera could not open (" + code + "). Open the UTSUSHI app once, then scan again.";
                c.close();
            }
        }, bg);
    }

    synchronized void stop() {
        if (!running) return;
        running = false;
        try {
            if (session != null) session.close();
        } catch (Exception ignored) {
        }
        try {
            if (camera != null) camera.close();
        } catch (Exception ignored) {
        }
        session = null;
        camera = null;
        final ImageReader r = reader;
        final HandlerThread t = thread;
        reader = null;
        thread = null;
        jpeg = null;
        if (t != null) {
            new Handler(t.getLooper()).post(() -> {
                if (r != null) r.close();
                t.quitSafely();
            });
        }
    }
}
