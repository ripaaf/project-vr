package com.questmirror.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Routes requests from the PC host. Accessibility-backed routes go to {@link ControlService}. */
final class Agent implements AgentServer.Handler {
    static final int PORT = 8766;
    static final String VERSION = "1.0.0";

    private static Agent instance;
    private final Context app;
    private final AgentServer server;

    private Agent(Context ctx) {
        app = ctx.getApplicationContext();
        server = new AgentServer(PORT, this);
    }

    static synchronized void ensureStarted(Context ctx) {
        if (instance == null) instance = new Agent(ctx);
        instance.server.start();
    }

    @Override
    public AgentServer.Response handle(AgentServer.Request req) throws Exception {
        switch (req.path) {
            case "/ping": {
                JSONObject o = new JSONObject();
                o.put("ok", true);
                o.put("version", VERSION);
                o.put("accessibility", ControlService.get() != null);
                return AgentServer.Response.json(o);
            }
            case "/apps":
                return AgentServer.Response.json(new JSONObject().put("apps", apps()));
            case "/icon":
                return icon(req.q("pkg", ""));
            case "/selfshot": {
                byte[] png = MainActivity.snapshot("1".equals(req.q("full", "")));
                if (png == null) return AgentServer.Response.error(404, "The Quest Mirror panel is not open");
                return new AgentServer.Response(200, "image/png", png);
            }
            case "/volume": {
                // Horizon OS ignores volume keys / shell volume commands; an app may still adjust media volume.
                android.media.AudioManager am = (android.media.AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
                String dir = req.json().optString("dir", "up");
                int how = dir.equals("down") ? android.media.AudioManager.ADJUST_LOWER
                        : dir.equals("mute") ? android.media.AudioManager.ADJUST_TOGGLE_MUTE : android.media.AudioManager.ADJUST_RAISE;
                am.adjustStreamVolume(android.media.AudioManager.STREAM_MUSIC, how, android.media.AudioManager.FLAG_SHOW_UI);
                JSONObject o = new JSONObject();
                o.put("ok", true);
                o.put("volume", am.getStreamVolume(android.media.AudioManager.STREAM_MUSIC));
                o.put("max", am.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC));
                o.put("muted", am.isStreamMute(android.media.AudioManager.STREAM_MUSIC));
                return AgentServer.Response.json(o);
            }
        }

        ControlService svc = ControlService.get();
        if (svc == null) return AgentServer.Response.error(503, "Panel control is off. Turn on the Quest Mirror accessibility service.");
        JSONObject b = req.json();
        switch (req.path) {
            case "/windows":
                return AgentServer.Response.json(new JSONObject().put("windows", svc.listWindows()));
            case "/shot":
                return svc.screenshot(Integer.parseInt(req.q("id", "-1")));
            case "/tap":
                return AgentServer.Response.json(svc.tap(b.optInt("id"), b.optInt("x"), b.optInt("y"), b.optBoolean("long")));
            case "/scroll":
                return AgentServer.Response.json(svc.scroll(b.optInt("id"), b.optInt("x"), b.optInt("y"), b.optString("dir", "down")));
            case "/text":
                return svc.typeText(b.has("id") ? b.optInt("id") : -1, b.optString("text", ""), b.optBoolean("enter"));
            case "/global":
                return AgentServer.Response.json(svc.global(b.optString("action")));
            default:
                return AgentServer.Response.error(404, "Unknown route " + req.path);
        }
    }

    private JSONArray apps() throws Exception {
        PackageManager pm = app.getPackageManager();
        Map<String, JSONObject> byPkg = new LinkedHashMap<>();
        String[] categories = {Intent.CATEGORY_LAUNCHER, "com.oculus.intent.category.VR"};
        for (String cat : categories) {
            Intent i = new Intent(Intent.ACTION_MAIN).addCategory(cat);
            List<ResolveInfo> list = pm.queryIntentActivities(i, 0);
            for (ResolveInfo ri : list) {
                String pkg = ri.activityInfo.packageName;
                if (byPkg.containsKey(pkg)) continue;
                ApplicationInfo ai = ri.activityInfo.applicationInfo;
                JSONObject o = new JSONObject();
                o.put("pkg", pkg);
                o.put("label", String.valueOf(ai.loadLabel(pm)));
                o.put("system", (ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0);
                byPkg.put(pkg, o);
            }
        }
        JSONArray arr = new JSONArray();
        for (JSONObject o : byPkg.values()) arr.put(o);
        return arr;
    }

    private AgentServer.Response icon(String pkg) {
        try {
            Drawable d = app.getPackageManager().getApplicationIcon(pkg);
            int size = 96;
            Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(bmp);
            d.setBounds(0, 0, size, size);
            d.draw(c);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.PNG, 100, out);
            bmp.recycle();
            return new AgentServer.Response(200, "image/png", out.toByteArray());
        } catch (Exception e) {
            return AgentServer.Response.error(404, "No icon for " + pkg);
        }
    }
}
