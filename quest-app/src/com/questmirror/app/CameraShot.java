package com.questmirror.app;

import android.content.Context;
import android.graphics.ImageFormat;
import android.graphics.Rect;
import android.graphics.YuvImage;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.media.Image;
import android.media.ImageReader;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Size;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.Collections;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * One photo through the headset's left passthrough camera (the space without the PC asks for it):
 * open, let the exposure settle for a few frames, keep the newest, crop to the frame you drew, JPEG.
 */
final class CameraShot {
    private CameraShot() {
    }

    @SuppressWarnings("MissingPermission")
    static synchronized byte[] take(Context ctx, double[] rect) throws Exception {
        CameraManager cm = (CameraManager) ctx.getSystemService(Context.CAMERA_SERVICE);
        String id = CameraScanner.pickCamera(cm);
        if (id == null) throw new IllegalStateException("No camera on this headset");
        Size size = CameraScanner.pickSize(cm, id);
        HandlerThread thread = new HandlerThread("photo-camera");
        thread.start();
        Handler bg = new Handler(thread.getLooper());
        ImageReader reader = ImageReader.newInstance(size.getWidth(), size.getHeight(), ImageFormat.YUV_420_888, 3);
        AtomicReference<CameraDevice> dev = new AtomicReference<>();
        AtomicReference<String> err = new AtomicReference<>();
        CountDownLatch opened = new CountDownLatch(1);
        CountDownLatch settled = new CountDownLatch(8); // ~8 frames for exposure and white balance
        reader.setOnImageAvailableListener(r -> {
            if (settled.getCount() > 1) {
                Image i = r.acquireLatestImage();
                if (i != null) i.close();
            }
            settled.countDown();
        }, bg);
        try {
            cm.openCamera(id, new CameraDevice.StateCallback() {
                @Override
                public void onOpened(CameraDevice c) {
                    dev.set(c);
                    opened.countDown();
                }

                @Override
                public void onDisconnected(CameraDevice c) {
                    err.set("The camera is busy with another app");
                    c.close();
                    opened.countDown();
                }

                @Override
                public void onError(CameraDevice c, int error) {
                    err.set("The camera could not open (" + error + ")");
                    c.close();
                    opened.countDown();
                }
            }, bg);
            if (!opened.await(4, TimeUnit.SECONDS) || dev.get() == null) throw new IllegalStateException(err.get() != null ? err.get() : "The camera did not answer");
            CameraDevice c = dev.get();
            CountDownLatch configured = new CountDownLatch(1);
            AtomicReference<CameraCaptureSession> sess = new AtomicReference<>();
            c.createCaptureSession(Collections.singletonList(reader.getSurface()), new CameraCaptureSession.StateCallback() {
                @Override
                public void onConfigured(CameraCaptureSession s) {
                    sess.set(s);
                    configured.countDown();
                }

                @Override
                public void onConfigureFailed(CameraCaptureSession s) {
                    configured.countDown();
                }
            }, bg);
            if (!configured.await(3, TimeUnit.SECONDS) || sess.get() == null) throw new IllegalStateException("The camera could not start");
            CaptureRequest.Builder b = c.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
            b.addTarget(reader.getSurface());
            sess.get().setRepeatingRequest(b.build(), null, bg);
            if (!settled.await(4, TimeUnit.SECONDS)) throw new IllegalStateException("The camera sent no picture");
            Image img = reader.acquireLatestImage();
            if (img == null) throw new IllegalStateException("The camera sent no picture");
            try {
                return jpeg(img, rect, 90);
            } finally {
                img.close();
                sess.get().close();
            }
        } finally {
            CameraDevice c = dev.get();
            if (c != null) c.close();
            reader.close();
            thread.quitSafely();
        }
    }

    /** YUV_420_888 → NV21 → JPEG, cropped to rect (0..1 of the picture; null = all of it). */
    static byte[] jpeg(Image img, double[] rect, int quality) {
        int w = img.getWidth();
        int h = img.getHeight();
        byte[] nv21 = new byte[w * h * 3 / 2];
        Image.Plane[] p = img.getPlanes();
        copyPlane(p[0].getBuffer(), p[0].getRowStride(), p[0].getPixelStride(), w, h, nv21, 0, 1);
        // NV21 interleaves V then U at half resolution
        copyPlane(p[2].getBuffer(), p[2].getRowStride(), p[2].getPixelStride(), w / 2, h / 2, nv21, w * h, 2);
        copyPlane(p[1].getBuffer(), p[1].getRowStride(), p[1].getPixelStride(), w / 2, h / 2, nv21, w * h + 1, 2);
        Rect crop = new Rect(0, 0, w, h);
        if (rect != null && rect.length == 4 && rect[2] - rect[0] > 0.05 && rect[3] - rect[1] > 0.05) {
            crop = new Rect((int) (clamp(rect[0]) * w) & ~1, (int) (clamp(rect[1]) * h) & ~1, (int) (clamp(rect[2]) * w) & ~1, (int) (clamp(rect[3]) * h) & ~1);
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        new YuvImage(nv21, ImageFormat.NV21, w, h, null).compressToJpeg(crop, quality, out);
        return out.toByteArray();
    }

    private static double clamp(double v) {
        return Math.max(0, Math.min(1, v));
    }

    private static void copyPlane(ByteBuffer buf, int rowStride, int pixelStride, int w, int h, byte[] out, int offset, int step) {
        int o = offset;
        for (int y = 0; y < h; y++) {
            int row = y * rowStride;
            for (int x = 0; x < w; x++) {
                out[o] = buf.get(row + x * pixelStride);
                o += step;
            }
        }
    }
}
