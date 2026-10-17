package com.questmirror.app;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.hardware.HardwareBuffer;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.util.SparseArray;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction;
import android.view.accessibility.AccessibilityWindowInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Accessibility service that lets the PC host click, scroll and type inside 2D app panels.
 * On Horizon OS every 2D app is a separate window, so actions target a window by id and act
 * on its UI nodes directly instead of injecting screen coordinates.
 */
public class ControlService extends AccessibilityService {
    private static final String TAG = "QuestMirror";
    private static volatile ControlService instance;

    private final SparseArray<byte[]> shotCache = new SparseArray<>();

    static ControlService get() {
        return instance;
    }

    @Override
    protected void onServiceConnected() {
        instance = this;
        Agent.ensureStarted(this);
        Log.i(TAG, "panel control connected");
    }

    @Override
    public boolean onUnbind(Intent intent) {
        instance = null;
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        instance = null;
        super.onDestroy();
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
    }

    @Override
    public void onInterrupt() {
    }

    // ------------------------------------------------------------------ windows

    private static final String[] SKIP_PACKAGES = {"com.oculus.vrshell", "com.oculus.systemux", "com.oculus.panelapp.library", "com.meta.systemui"};

    JSONArray listWindows() throws Exception {
        JSONArray out = new JSONArray();
        PackageManager pm = getPackageManager();
        for (AccessibilityWindowInfo w : getWindows()) {
            if (w.getType() != AccessibilityWindowInfo.TYPE_APPLICATION) continue;
            Rect b = new Rect();
            w.getBoundsInScreen(b);
            if (b.width() < 200 || b.height() < 150) continue;
            AccessibilityNodeInfo root = w.getRoot();
            String pkg = root != null && root.getPackageName() != null ? root.getPackageName().toString() : "";
            if (pkg.isEmpty() || pkg.equals(getPackageName())) continue;
            boolean skip = false;
            for (String s : SKIP_PACKAGES) if (pkg.startsWith(s)) skip = true;
            if (skip) continue;
            String title = w.getTitle() != null ? w.getTitle().toString() : "";
            if (title.isEmpty()) {
                try {
                    title = String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)));
                } catch (Exception ignored) {
                    title = pkg;
                }
            }
            JSONObject o = new JSONObject();
            o.put("id", w.getId());
            o.put("pkg", pkg);
            o.put("title", title);
            o.put("x", b.left);
            o.put("y", b.top);
            o.put("w", b.width());
            o.put("h", b.height());
            o.put("focused", w.isFocused());
            o.put("active", w.isActive());
            out.put(o);
        }
        return out;
    }

    private AccessibilityWindowInfo findWindow(int id) {
        for (AccessibilityWindowInfo w : getWindows()) if (w.getId() == id) return w;
        return null;
    }

    // ------------------------------------------------------------------ screenshot

    AgentServer.Response screenshot(int windowId) {
        if (Build.VERSION.SDK_INT < 34) return AgentServer.Response.error(501, "Panel view needs Horizon OS based on Android 14 or newer");
        if (findWindow(windowId) == null) return AgentServer.Response.error(404, "That window is gone");
        final CountDownLatch done = new CountDownLatch(1);
        final AtomicReference<byte[]> jpeg = new AtomicReference<>();
        final AtomicReference<String> err = new AtomicReference<>();
        takeScreenshotOfWindow(windowId, getMainExecutor(), new TakeScreenshotCallback() {
            @Override
            public void onSuccess(ScreenshotResult result) {
                try {
                    HardwareBuffer hb = result.getHardwareBuffer();
                    Bitmap hw = Bitmap.wrapHardwareBuffer(hb, result.getColorSpace());
                    if (hw != null) {
                        Bitmap sw = hw.copy(Bitmap.Config.ARGB_8888, false);
                        ByteArrayOutputStream out = new ByteArrayOutputStream();
                        sw.compress(Bitmap.CompressFormat.JPEG, 82, out);
                        jpeg.set(out.toByteArray());
                        sw.recycle();
                        hw.recycle();
                    }
                    hb.close();
                } catch (Exception e) {
                    err.set(e.toString());
                }
                done.countDown();
            }

            @Override
            public void onFailure(int errorCode) {
                err.set("screenshot error " + errorCode);
                done.countDown();
            }
        });
        try {
            done.await(3, TimeUnit.SECONDS);
        } catch (InterruptedException ignored) {
        }
        byte[] img = jpeg.get();
        if (img != null) {
            shotCache.put(windowId, img);
            return new AgentServer.Response(200, "image/jpeg", img);
        }
        // Android limits screenshots to ~3 per second; reuse the last one in between.
        byte[] cached = shotCache.get(windowId);
        if (cached != null) return new AgentServer.Response(200, "image/jpeg", cached);
        return AgentServer.Response.error(500, err.get() == null ? "screenshot timed out" : err.get());
    }

    // ------------------------------------------------------------------ node helpers

    /** Deepest visible node whose bounds contain (sx, sy). Later children are drawn on top, so search them first. */
    private static AccessibilityNodeInfo deepestAt(AccessibilityNodeInfo node, int sx, int sy) {
        if (node == null) return null;
        Rect r = new Rect();
        node.getBoundsInScreen(r);
        if (!r.contains(sx, sy) || !node.isVisibleToUser()) return null;
        for (int i = node.getChildCount() - 1; i >= 0; i--) {
            AccessibilityNodeInfo hit = deepestAt(node.getChild(i), sx, sy);
            if (hit != null) return hit;
        }
        return node;
    }

    private static String describe(AccessibilityNodeInfo n) {
        if (n == null) return "";
        CharSequence t = n.getText() != null ? n.getText() : n.getContentDescription();
        String cls = n.getClassName() != null ? n.getClassName().toString() : "";
        cls = cls.substring(cls.lastIndexOf('.') + 1);
        return t != null && t.length() > 0 ? cls + " \"" + (t.length() > 40 ? t.subSequence(0, 40) + "…" : t) + "\"" : cls;
    }

    private AccessibilityNodeInfo lastEditable;

    JSONObject tap(int windowId, int x, int y, boolean longPress) throws Exception {
        JSONObject res = new JSONObject();
        AccessibilityWindowInfo w = findWindow(windowId);
        if (w == null) return res.put("ok", false).put("message", "That window is gone");
        Rect wb = new Rect();
        w.getBoundsInScreen(wb);
        AccessibilityNodeInfo target = deepestAt(w.getRoot(), wb.left + x, wb.top + y);
        if (target == null) return res.put("ok", false).put("message", "Nothing there");
        if (target.isEditable()) {
            lastEditable = target;
            target.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
        }
        AccessibilityNodeInfo n = target;
        while (n != null && !(longPress ? n.isLongClickable() : n.isClickable())) n = n.getParent();
        boolean ok = false;
        if (n != null) ok = n.performAction(longPress ? AccessibilityNodeInfo.ACTION_LONG_CLICK : AccessibilityNodeInfo.ACTION_CLICK);
        else if (target.isFocusable()) ok = target.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
        res.put("ok", ok);
        res.put("node", describe(n != null ? n : target));
        if (!ok) res.put("message", "Nothing clickable there");
        return res;
    }

    JSONObject scroll(int windowId, int x, int y, String dir) throws Exception {
        JSONObject res = new JSONObject();
        AccessibilityWindowInfo w = findWindow(windowId);
        if (w == null) return res.put("ok", false).put("message", "That window is gone");
        Rect wb = new Rect();
        w.getBoundsInScreen(wb);
        AccessibilityNodeInfo n = deepestAt(w.getRoot(), wb.left + x, wb.top + y);
        while (n != null && !n.isScrollable()) n = n.getParent();
        if (n == null) n = largestScrollable(w.getRoot());
        if (n == null) return res.put("ok", false).put("message", "Nothing scrollable there");

        AccessibilityAction directional = null;
        switch (dir) {
            case "up": directional = AccessibilityAction.ACTION_SCROLL_UP; break;
            case "down": directional = AccessibilityAction.ACTION_SCROLL_DOWN; break;
            case "left": directional = AccessibilityAction.ACTION_SCROLL_LEFT; break;
            case "right": directional = AccessibilityAction.ACTION_SCROLL_RIGHT; break;
        }
        boolean ok = false;
        if (directional != null && n.getActionList().contains(directional)) ok = n.performAction(directional.getId());
        if (!ok) {
            boolean forward = dir.equals("down") || dir.equals("right");
            ok = n.performAction(forward ? AccessibilityNodeInfo.ACTION_SCROLL_FORWARD : AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD);
        }
        return res.put("ok", ok);
    }

    private static AccessibilityNodeInfo largestScrollable(AccessibilityNodeInfo root) {
        if (root == null) return null;
        AccessibilityNodeInfo best = null;
        int bestArea = 0;
        java.util.ArrayDeque<AccessibilityNodeInfo> queue = new java.util.ArrayDeque<>();
        queue.add(root);
        int visited = 0;
        while (!queue.isEmpty() && visited++ < 3000) {
            AccessibilityNodeInfo n = queue.poll();
            if (n.isScrollable()) {
                Rect r = new Rect();
                n.getBoundsInScreen(r);
                int area = r.width() * r.height();
                if (area > bestArea) {
                    bestArea = area;
                    best = n;
                }
            }
            for (int i = 0; i < n.getChildCount(); i++) {
                AccessibilityNodeInfo c = n.getChild(i);
                if (c != null) queue.add(c);
            }
        }
        return best;
    }

    AgentServer.Response typeText(int windowId, String text, boolean enter) throws Exception {
        AccessibilityNodeInfo field = null;
        List<AccessibilityWindowInfo> windows = getWindows();
        for (AccessibilityWindowInfo w : windows) {
            if (windowId >= 0 && w.getId() != windowId) continue;
            AccessibilityNodeInfo root = w.getRoot();
            if (root == null) continue;
            AccessibilityNodeInfo f = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
            if (f != null && f.isEditable()) {
                field = f;
                break;
            }
        }
        if (field == null && lastEditable != null && lastEditable.refresh() && lastEditable.isEditable()) field = lastEditable;
        if (field == null) return AgentServer.Response.error(409, "No focused text field. Tap a text box first.");

        if (!text.isEmpty()) {
            CharSequence current = field.getText();
            if (Build.VERSION.SDK_INT >= 26 && field.isShowingHintText()) current = "";
            Bundle args = new Bundle();
            args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, (current == null ? "" : current.toString()) + text);
            field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
        }
        boolean entered = false;
        if (enter && Build.VERSION.SDK_INT >= 30) {
            entered = field.performAction(AccessibilityAction.ACTION_IME_ENTER.getId());
        }
        JSONObject o = new JSONObject();
        o.put("ok", true);
        o.put("entered", entered);
        o.put("node", describe(field));
        return AgentServer.Response.json(o);
    }

    JSONObject global(String action) throws Exception {
        int a;
        switch (action) {
            case "back": a = GLOBAL_ACTION_BACK; break;
            case "home": a = GLOBAL_ACTION_HOME; break;
            case "recents": a = GLOBAL_ACTION_RECENTS; break;
            case "notifications": a = GLOBAL_ACTION_NOTIFICATIONS; break;
            case "quick_settings": a = GLOBAL_ACTION_QUICK_SETTINGS; break;
            default: return new JSONObject().put("ok", false).put("message", "Unknown action");
        }
        return new JSONObject().put("ok", performGlobalAction(a));
    }
}
