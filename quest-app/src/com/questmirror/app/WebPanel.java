package com.questmirror.app;

import android.app.Presentation;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.net.URLEncoder;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * The space's web browser when there is no PC: a real web view living on a private screen of this
 * app (a virtual display nobody sees), its picture sent to the space, your taps and typing sent back.
 * Sound plays from the headset directly. It starts when the Web window asks and ends a minute after.
 */
final class WebPanel {
    static final int W = 1280;
    static final int H = 720;
    private static final String HOME = "https://www.youtube.com/";
    private static final String UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    private static WebPanel instance;

    private final Context ctx;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Object lock = new Object();
    private HandlerThread thread;
    private Handler frames;
    private VirtualDisplay display;
    private ImageReader reader;
    private Presentation screen;
    private WebView web;
    private Bitmap bmp;
    private volatile byte[] jpeg;
    private volatile int seq;
    private volatile long askedAt;
    private long encodedAt;
    private boolean later;
    private long downAt;
    // what the Web window shows in its bar (read from any thread)
    private volatile String url = "";
    private volatile String title = "";
    private volatile boolean loading;
    private volatile boolean back;
    private volatile boolean fwd;
    private volatile boolean typing;
    private volatile long focusAt;

    private WebPanel(Context c) {
        ctx = c.getApplicationContext();
    }

    static synchronized WebPanel get(Context c) {
        if (instance == null) instance = new WebPanel(c);
        return instance;
    }

    // ------------------------------------------------------------------ life

    private void ensure() throws Exception {
        askedAt = SystemClock.uptimeMillis();
        if (web != null) return;
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<Exception> err = new AtomicReference<>();
        main.post(() -> {
            try {
                if (web == null) start();
            } catch (Exception e) {
                err.set(e);
            }
            done.countDown();
        });
        if (!done.await(8, TimeUnit.SECONDS)) throw new IllegalStateException("The browser did not start");
        if (err.get() != null) throw err.get();
    }

    private void start() {
        thread = new HandlerThread("web-frames");
        thread.start();
        frames = new Handler(thread.getLooper());
        reader = ImageReader.newInstance(W, H, PixelFormat.RGBA_8888, 2);
        reader.setOnImageAvailableListener(r -> onFrame(), frames);
        DisplayManager dm = ctx.getSystemService(DisplayManager.class);
        display = dm.createVirtualDisplay("utsushi-web", W, H, 160, reader.getSurface(), DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY);
        screen = new Presentation(ctx, display.getDisplay());
        web = new WebView(screen.getContext());
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(UA);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String u) {
                return !(u.startsWith("http:") || u.startsWith("https:")); // other schemes (apps, intents) stay out
            }

            @Override
            public void onPageStarted(WebView v, String u, Bitmap icon) {
                loading = true;
                remember();
            }

            @Override
            public void onPageFinished(WebView v, String u) {
                loading = false;
                remember();
            }

            @Override
            public void doUpdateVisitedHistory(WebView v, String u, boolean reload) {
                remember();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onReceivedTitle(WebView v, String t) {
                remember();
            }
        });
        screen.setContentView(web);
        screen.show();
        web.loadUrl(HOME);
        main.postDelayed(this::idleCheck, 15000);
    }

    private void remember() {
        if (web == null) return;
        url = web.getUrl() == null ? "" : web.getUrl();
        title = web.getTitle() == null ? "" : web.getTitle();
        back = web.canGoBack();
        fwd = web.canGoForward();
    }

    private void idleCheck() {
        if (web == null) return;
        if (SystemClock.uptimeMillis() - askedAt > 60000) stop();
        else main.postDelayed(this::idleCheck, 15000);
    }

    private void stop() {
        try {
            if (screen != null) screen.dismiss();
            if (web != null) web.destroy();
            if (display != null) display.release();
        } catch (Exception ignored) {
        }
        final ImageReader r = reader;
        final HandlerThread t = thread;
        web = null;
        screen = null;
        display = null;
        reader = null;
        thread = null;
        jpeg = null;
        if (t != null)
            new Handler(t.getLooper()).post(() -> {
                if (r != null) r.close();
                t.quitSafely();
            });
    }

    // ------------------------------------------------------------------ the picture

    /** At most ~12 pictures a second; a frame that comes too soon is picked up a moment later. */
    private void onFrame() {
        long now = SystemClock.uptimeMillis();
        long wait = 80 - (now - encodedAt);
        if (wait > 0) {
            if (!later) {
                later = true;
                frames.postDelayed(() -> {
                    later = false;
                    encode();
                }, wait);
            }
            return;
        }
        encode();
    }

    private void encode() {
        ImageReader r = reader;
        if (r == null) return;
        Image img = r.acquireLatestImage();
        if (img == null) return;
        try {
            if (SystemClock.uptimeMillis() - askedAt > 4000) return; // nobody is looking
            encodedAt = SystemClock.uptimeMillis();
            Image.Plane p = img.getPlanes()[0];
            int rowPx = p.getRowStride() / p.getPixelStride();
            if (bmp == null || bmp.getWidth() != rowPx) bmp = Bitmap.createBitmap(rowPx, H, Bitmap.Config.ARGB_8888);
            bmp.copyPixelsFromBuffer(p.getBuffer());
            Bitmap view = rowPx == W ? bmp : Bitmap.createBitmap(bmp, 0, 0, W, H);
            ByteArrayOutputStream out = new ByteArrayOutputStream(160000);
            view.compress(Bitmap.CompressFormat.JPEG, 68, out);
            jpeg = out.toByteArray();
            synchronized (lock) {
                seq++;
                lock.notifyAll();
            }
        } finally {
            img.close();
        }
    }

    /** A newer picture than `after` (waiting up to half a second), or null when nothing changed. */
    byte[] frame(int after) throws Exception {
        ensure();
        synchronized (lock) {
            long until = SystemClock.uptimeMillis() + 500;
            while ((seq <= after || jpeg == null) && SystemClock.uptimeMillis() < until) lock.wait(Math.max(1, until - SystemClock.uptimeMillis()));
            return seq > after ? jpeg : null;
        }
    }

    int seq() {
        return seq;
    }

    JSONObject state() throws Exception {
        ensure();
        return new JSONObject().put("url", url).put("title", title).put("loading", loading).put("back", back).put("fwd", fwd)
                .put("typing", typing).put("focusAt", focusAt).put("running", true);
    }

    // ------------------------------------------------------------------ input (same events as the PC's browser)

    void input(JSONArray events) throws Exception {
        ensure();
        main.post(() -> {
            if (web == null) return;
            for (int i = 0; i < events.length(); i++) {
                JSONObject e = events.optJSONObject(i);
                if (e != null) apply(e);
            }
        });
    }

    private void apply(JSONObject e) {
        String t = e.optString("t");
        float x = (float) (Math.max(0, Math.min(1, e.optDouble("x", 0))) * W);
        float y = (float) (Math.max(0, Math.min(1, e.optDouble("y", 0))) * H);
        long now = SystemClock.uptimeMillis();
        switch (t) {
            case "down":
                downAt = now;
                touch(MotionEvent.ACTION_DOWN, x, y, now);
                break;
            case "move":
                if (e.optBoolean("held")) touch(MotionEvent.ACTION_MOVE, x, y, now);
                break;
            case "up":
                touch(MotionEvent.ACTION_UP, x, y, now);
                // did that tap land in a text field? (the space then brings up its keyboard)
                main.postDelayed(() -> {
                    if (web != null) web.evaluateJavascript("(() => { const a = document.activeElement; return !!a && (a.isContentEditable || a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(button|checkbox|radio|submit|range|color|file|image|reset)$/i.test(a.type))); })()", v -> {
                        typing = "true".equals(v);
                        focusAt = System.currentTimeMillis();
                    });
                }, 150);
                break;
            case "wheel": {
                MotionEvent.PointerProperties pp = new MotionEvent.PointerProperties();
                pp.id = 0;
                pp.toolType = MotionEvent.TOOL_TYPE_MOUSE;
                MotionEvent.PointerCoords pc = new MotionEvent.PointerCoords();
                pc.x = x;
                pc.y = y;
                pc.setAxisValue(MotionEvent.AXIS_VSCROLL, (float) (-e.optDouble("dy", 0) / 60.0));
                MotionEvent ev = MotionEvent.obtain(now, now, MotionEvent.ACTION_SCROLL, 1, new MotionEvent.PointerProperties[]{pp}, new MotionEvent.PointerCoords[]{pc}, 0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_MOUSE, 0);
                web.dispatchGenericMotionEvent(ev);
                ev.recycle();
                break;
            }
            case "text":
                web.evaluateJavascript("document.execCommand('insertText', false, " + JSONObject.quote(e.optString("s")) + ")", null);
                break;
            case "key": {
                int code;
                switch (e.optString("k")) {
                    case "Enter": code = KeyEvent.KEYCODE_ENTER; break;
                    case "Backspace": code = KeyEvent.KEYCODE_DEL; break;
                    case "Tab": code = KeyEvent.KEYCODE_TAB; break;
                    case "Escape": code = KeyEvent.KEYCODE_ESCAPE; break;
                    case "ArrowLeft": code = KeyEvent.KEYCODE_DPAD_LEFT; break;
                    case "ArrowRight": code = KeyEvent.KEYCODE_DPAD_RIGHT; break;
                    case "ArrowUp": code = KeyEvent.KEYCODE_DPAD_UP; break;
                    case "ArrowDown": code = KeyEvent.KEYCODE_DPAD_DOWN; break;
                    default: code = 0;
                }
                if (code != 0) {
                    web.dispatchKeyEvent(new KeyEvent(now, now, KeyEvent.ACTION_DOWN, code, 0));
                    web.dispatchKeyEvent(new KeyEvent(now, now, KeyEvent.ACTION_UP, code, 0));
                }
                break;
            }
            case "nav":
                web.loadUrl(address(e.optString("url")));
                break;
            case "back":
                if (web.canGoBack()) web.goBack();
                break;
            case "forward":
                if (web.canGoForward()) web.goForward();
                break;
            case "reload":
                web.reload();
                break;
            default:
        }
    }

    private void touch(int action, float x, float y, long now) {
        MotionEvent ev = MotionEvent.obtain(downAt, now, action, x, y, 0);
        ev.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        web.dispatchTouchEvent(ev);
        ev.recycle();
    }

    /** An address, or words to search for. */
    private static String address(String in) {
        String u = in == null ? "" : in.trim();
        if (u.isEmpty()) return HOME;
        if (u.matches("(?i)^https?://.*")) return u;
        if (u.matches("(?i)^[^\\s]+\\.[a-z]{2,}(/.*)?$")) return "https://" + u;
        try {
            return "https://www.google.com/search?q=" + URLEncoder.encode(u, "UTF-8");
        } catch (Exception ex) {
            return HOME;
        }
    }
}
