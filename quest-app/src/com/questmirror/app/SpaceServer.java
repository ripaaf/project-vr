package com.questmirror.app;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.Build;
import android.os.SystemClock;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * UTSUSHI Space without the PC: the headset serves the space itself, from the copy inside this app,
 * on http://localhost:8770/space/ (a secure origin, so WebXR runs). Notes, models and scans are kept
 * in this app's storage. Things only the PC can do (photos, the PC screen, files, the shell, devices)
 * answer "needs your PC", and the space says so plainly.
 */
final class SpaceServer {
    static final int PORT = 8770;
    static final String URL = "http://localhost:" + PORT + "/space/";
    private static SpaceServer instance;

    private static final Pattern NOTE = Pattern.compile("^/api/space/note/([a-z0-9-]{6,40})$");
    private static final Pattern PHOTO = Pattern.compile("^utsushi-[\\w-]+\\.jpg$");
    private static final Pattern MODEL = Pattern.compile("^[\\w .()-]+\\.(glb|gltf|obj|stl|ply)$", Pattern.CASE_INSENSITIVE);

    private final Context app;
    private final File notes;
    private final File models;
    private final File photos;
    private final AgentServer server;

    private SpaceServer(Context c) {
        app = c.getApplicationContext();
        notes = new File(app.getFilesDir(), "notes");
        models = new File(app.getFilesDir(), "models");
        photos = new File(app.getFilesDir(), "photos");
        server = new AgentServer(PORT, this::handle, 48 * 1024 * 1024);
    }

    /** Starts (once) and returns true when the space is being served. */
    static synchronized boolean start(Context c) {
        if (instance == null) instance = new SpaceServer(c);
        return instance.server.start();
    }

    // ------------------------------------------------------------------ routing

    private AgentServer.Response handle(AgentServer.Request r) throws Exception {
        String p = r.path;
        // writes only from the space itself: a JSON body can't be sent by another site without asking first
        if (r.method.equals("POST") && p.startsWith("/api/") && !r.headers.getOrDefault("content-type", "").startsWith("application/json"))
            return AgentServer.Response.error(415, "JSON only");
        // Linux in the Terminal (Alpine, in the UTSUSHI Linux companion); the space opened from the PC
        // (localhost:8765) uses it too, so it may ask first (CORS) and read the answers
        if (p.startsWith("/api/space/linux/")) {
            boolean fromPc = "http://localhost:8765".equals(r.headers.get("origin"));
            String sub = p.substring("/api/space/linux".length());
            AgentServer.Response res;
            if (r.method.equals("OPTIONS")) res = new AgentServer.Response(fromPc ? 204 : 403, "text/plain", new byte[0]);
            else if (!sub.matches("/(state|install|remove|shell|shell/read|shell/input|shell/close)")) res = AgentServer.Response.error(404, "Not found");
            else {
                StringBuilder q = new StringBuilder();
                for (java.util.Map.Entry<String, String> e : r.query.entrySet())
                    q.append(q.length() == 0 ? '?' : '&').append(java.net.URLEncoder.encode(e.getKey(), "UTF-8")).append('=').append(java.net.URLEncoder.encode(e.getValue(), "UTF-8"));
                res = LinuxBridge.forward(app, r.method, sub + q, r.body);
            }
            if (fromPc) res.extra += "Access-Control-Allow-Origin: http://localhost:8765\r\nAccess-Control-Allow-Methods: GET, POST\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Max-Age: 600\r\n";
            return res;
        }
        // the camera for colouring scans; the space opened from the PC (localhost:8765) may read it too
        if (p.equals("/api/space/camera/info") || p.equals("/api/space/camera/frame")) {
            AgentServer.Response res;
            try {
                if (p.endsWith("info")) res = AgentServer.Response.json(CameraFeed.get(app).info());
                else {
                    byte[] f = CameraFeed.get(app).frame();
                    res = f == null ? AgentServer.Response.error(503, "The camera is starting") : new AgentServer.Response(200, "image/jpeg", f);
                    if (f != null) res.extra = "X-Age-Ms: " + CameraFeed.get(app).ageMs() + "\r\n"; // when it was taken
                }
            } catch (Exception e) {
                res = AgentServer.Response.error(503, e.getMessage() == null ? e.toString() : e.getMessage());
            }
            if ("http://localhost:8765".equals(r.headers.get("origin"))) res.extra += "Access-Control-Allow-Origin: http://localhost:8765\r\nAccess-Control-Expose-Headers: X-Age-Ms\r\n";
            return res;
        }
        if (p.equals("/") || p.equals("/space")) return redirect();
        if (p.startsWith("/space/")) return asset(p.equals("/space/") ? "space/index.html" : p.substring(1));
        // the web, on the Quest itself (a web view on a hidden screen of this app)
        if (p.equals("/api/space/web/state")) return AgentServer.Response.json(WebPanel.get(app).state());
        if (p.equals("/api/space/web/frame")) {
            int after;
            try {
                after = Integer.parseInt(r.q("after", "-1"));
            } catch (Exception e) {
                after = -1;
            }
            WebPanel wp = WebPanel.get(app);
            byte[] f = wp.frame(after);
            if (f == null) return new AgentServer.Response(204, "image/jpeg", new byte[0]);
            AgentServer.Response res = new AgentServer.Response(200, "image/jpeg", f);
            res.extra = "X-Seq: " + wp.seq() + "\r\n";
            return res;
        }
        if (p.equals("/api/space/web/input") && r.method.equals("POST")) {
            WebPanel.get(app).input(r.json().optJSONArray("events") == null ? new JSONArray() : r.json().optJSONArray("events"));
            return AgentServer.Response.json(new JSONObject().put("ok", true));
        }
        if (p.equals("/api/space/net")) return AgentServer.Response.json(new JSONObject().put("interfaces", interfaces()));
        if (p.equals("/api/space/mode")) return AgentServer.Response.json(new JSONObject().put("standalone", true));
        if (p.equals("/api/space/stats")) return AgentServer.Response.json(stats());
        if (p.equals("/api/space/notes") && r.method.equals("GET")) return AgentServer.Response.json(new JSONObject().put("notes", listNotes()));
        Matcher m = NOTE.matcher(p);
        if (m.matches()) return note(r, m.group(1));
        if (p.equals("/api/space/models")) return AgentServer.Response.json(new JSONObject().put("models", listModels()));
        if (p.startsWith("/api/space/model/")) return modelFile(java.net.URLDecoder.decode(p.substring("/api/space/model/".length()), "UTF-8"));
        if (p.equals("/api/space/model-save") && r.method.equals("POST")) return saveScan(r.json().optString("ply", ""));
        if (p.equals("/api/space/model-delete") && r.method.equals("POST")) {
            File f = model(r.json().optString("file", ""));
            if (f == null || !f.delete()) return AgentServer.Response.error(404, "No such model");
            return AgentServer.Response.json(new JSONObject().put("ok", true));
        }
        // photos taken with the headset's camera (the space sends the picture)
        if (p.equals("/api/space/photos")) return AgentServer.Response.json(new JSONObject().put("photos", listPhotos()));
        if (p.startsWith("/api/space/photo/") || p.startsWith("/api/space/photo-thumb/")) {
            File f = photo(java.net.URLDecoder.decode(p.substring(p.lastIndexOf('/') + 1), "UTF-8"));
            if (f == null || !f.exists()) return AgentServer.Response.error(404, "No such photo");
            return new AgentServer.Response(200, "image/jpeg", readAll(new FileInputStream(f)));
        }
        if (p.equals("/api/space/photo-save") && r.method.equals("POST")) return savePhoto(r.json().optString("jpg", ""));
        if (p.equals("/api/space/snap") && r.method.equals("POST")) {
            // the headset's own passthrough camera, cropped to the frame you drew
            JSONArray a = r.json().optJSONArray("rect");
            double[] rect = a != null && a.length() == 4 ? new double[]{a.optDouble(0), a.optDouble(1), a.optDouble(2), a.optDouble(3)} : null;
            return savePhoto(Base64.encodeToString(CameraShot.take(app, rect), Base64.NO_WRAP));
        }
        if (p.equals("/api/space/photo-delete") && r.method.equals("POST")) {
            File f = photo(r.json().optString("name", ""));
            if (f == null || !f.delete()) return AgentServer.Response.error(404, "No such photo");
            return AgentServer.Response.json(new JSONObject().put("ok", true));
        }
        // Files: the Quest's own storage, answered like the PC does
        if (p.startsWith("/api/files/")) {
            String path = r.q("path", "");
            JSONObject b = r.method.equals("POST") ? r.json() : new JSONObject();
            switch (p) {
                case "/api/files/roots":
                    return AgentServer.Response.json(QuestFiles.roots());
                case "/api/files/list":
                    return AgentServer.Response.json(QuestFiles.list(path));
                case "/api/files/search":
                    return AgentServer.Response.json(QuestFiles.search(path, r.q("q", "")));
                case "/api/files/raw": {
                    java.io.File f = QuestFiles.raw(path);
                    String type = java.net.URLConnection.guessContentTypeFromName(f.getName());
                    return AgentServer.Response.file(f, type == null ? "application/octet-stream" : type);
                }
                case "/api/files/thumb":
                    return new AgentServer.Response(200, "image/jpeg", QuestFiles.thumb(path));
                case "/api/files/mkdir":
                    QuestFiles.mkdir(b.optString("dir"), b.optString("name"));
                    return AgentServer.Response.json(new JSONObject().put("ok", true));
                case "/api/files/rename":
                    QuestFiles.rename(b.optString("path"), b.optString("name"));
                    return AgentServer.Response.json(new JSONObject().put("ok", true));
                case "/api/files/delete":
                    QuestFiles.delete(b.optJSONArray("paths") == null ? new JSONArray() : b.optJSONArray("paths"));
                    return AgentServer.Response.json(new JSONObject().put("ok", true));
                case "/api/files/copy": {
                    JSONObject dest = b.optJSONObject("dest");
                    if (dest == null || !"quest".equals(dest.optString("src"))) return AgentServer.Response.error(503, "Sending to the PC needs the PC.");
                    QuestFiles.copy(b.optJSONArray("paths") == null ? new JSONArray() : b.optJSONArray("paths"), dest.optString("dir"), b.optBoolean("move"));
                    return AgentServer.Response.json(new JSONObject().put("ok", true));
                }
                default:
                    return AgentServer.Response.error(404, "Not found");
            }
        }
        // Terminal: a shell run by this app (read a moment at a time)
        if (p.equals("/api/space/shell") && r.method.equals("POST")) return AgentServer.Response.json(new JSONObject().put("id", Shells.open(app)));
        if (p.equals("/api/space/shell/read")) {
            int since;
            try {
                since = Integer.parseInt(r.q("since", "0"));
            } catch (Exception e) {
                since = 0;
            }
            return AgentServer.Response.json(Shells.read(r.q("id", ""), since));
        }
        if (p.equals("/api/space/shell/input") && r.method.equals("POST")) {
            JSONObject b = r.json();
            return Shells.input(b.optString("id"), b.optString("line")) ? AgentServer.Response.json(new JSONObject().put("ok", true)) : AgentServer.Response.error(404, "Shell ended");
        }
        if (p.equals("/api/space/shell/close") && r.method.equals("POST")) {
            Shells.close(r.json().optString("id"));
            return AgentServer.Response.json(new JSONObject().put("ok", true));
        }
        return AgentServer.Response.error(503, "This needs your PC. Connect the Quest to it with the cable.");
    }

    private static AgentServer.Response redirect() {
        String html = "<meta http-equiv=refresh content=\"0;url=/space/\">";
        return new AgentServer.Response(200, "text/html", html.getBytes(StandardCharsets.UTF_8));
    }

    // ------------------------------------------------------------------ the space's files

    private AgentServer.Response asset(String path) {
        if (path.contains("..")) return AgentServer.Response.error(400, "Bad path");
        try (InputStream in = app.getAssets().open(path)) {
            return new AgentServer.Response(200, mime(path), readAll(in));
        } catch (Exception e) {
            return AgentServer.Response.error(404, "Not found");
        }
    }

    private static String mime(String p) {
        String l = p.toLowerCase(Locale.ROOT);
        if (l.endsWith(".html")) return "text/html; charset=utf-8";
        if (l.endsWith(".js") || l.endsWith(".mjs")) return "text/javascript; charset=utf-8";
        if (l.endsWith(".css")) return "text/css; charset=utf-8";
        if (l.endsWith(".json")) return "application/json";
        if (l.endsWith(".svg")) return "image/svg+xml";
        if (l.endsWith(".png")) return "image/png";
        if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
        if (l.endsWith(".woff2")) return "font/woff2";
        if (l.endsWith(".glb")) return "model/gltf-binary";
        return "application/octet-stream";
    }

    private static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] b = new byte[65536];
        int n;
        while ((n = in.read(b)) > 0) out.write(b, 0, n);
        return out.toByteArray();
    }

    // ------------------------------------------------------------------ headset status

    private JSONObject stats() throws Exception {
        Intent b = app.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        JSONObject q = new JSONObject();
        if (b != null) {
            int level = b.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = b.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
            q.put("battery", level < 0 ? JSONObject.NULL : Math.round(level * 100f / scale));
            q.put("tempC", b.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) / 10.0);
            int st = b.getIntExtra(BatteryManager.EXTRA_STATUS, 0);
            q.put("charging", st == BatteryManager.BATTERY_STATUS_CHARGING || st == BatteryManager.BATTERY_STATUS_FULL);
        }
        q.put("uptime", SystemClock.elapsedRealtime() / 1000.0);
        android.app.ActivityManager am = (android.app.ActivityManager) app.getSystemService(Context.ACTIVITY_SERVICE);
        android.app.ActivityManager.MemoryInfo mi = new android.app.ActivityManager.MemoryInfo();
        am.getMemoryInfo(mi);
        q.put("memTotal", mi.totalMem / 1024);
        q.put("memAvail", mi.availMem / 1024);
        q.put("build", Build.DISPLAY);
        q.put("model", Build.MODEL);
        String ip = wifiIp();
        if (ip != null) q.put("wifiIp", ip);
        return new JSONObject().put("time", System.currentTimeMillis()).put("pc", JSONObject.NULL).put("quest", q).put("standalone", true);
    }

    // ------------------------------------------------------------------ network (ip / ifconfig in the Terminal)

    private static JSONArray interfaces() throws Exception {
        JSONArray out = new JSONArray();
        java.util.Enumeration<java.net.NetworkInterface> all = java.net.NetworkInterface.getNetworkInterfaces();
        while (all != null && all.hasMoreElements()) {
            java.net.NetworkInterface n = all.nextElement();
            JSONArray addrs = new JSONArray();
            for (java.net.InterfaceAddress a : n.getInterfaceAddresses()) {
                String h = a.getAddress().getHostAddress();
                int pct = h.indexOf('%');
                addrs.put((pct > 0 ? h.substring(0, pct) : h) + "/" + a.getNetworkPrefixLength());
            }
            if (addrs.length() == 0 && !n.isUp()) continue;
            out.put(new JSONObject().put("name", n.getName()).put("up", n.isUp()).put("loopback", n.isLoopback()).put("mtu", n.getMTU()).put("addrs", addrs));
        }
        return out;
    }

    private static String wifiIp() {
        try {
            java.util.Enumeration<java.net.NetworkInterface> all = java.net.NetworkInterface.getNetworkInterfaces();
            while (all != null && all.hasMoreElements()) {
                java.net.NetworkInterface n = all.nextElement();
                if (!n.isUp() || n.isLoopback() || !n.getName().startsWith("wlan")) continue;
                for (java.net.InterfaceAddress a : n.getInterfaceAddresses())
                    if (a.getAddress() instanceof java.net.Inet4Address) return a.getAddress().getHostAddress();
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    // ------------------------------------------------------------------ notes

    private JSONArray listNotes() {
        List<JSONObject> out = new ArrayList<>();
        File[] fs = notes.listFiles();
        if (fs != null) {
            for (File f : fs) {
                if (!f.getName().matches("^[a-z0-9-]{6,40}\\.json$")) continue;
                try {
                    JSONObject n = new JSONObject(new String(readAll(new FileInputStream(f)), StandardCharsets.UTF_8));
                    JSONObject s = new JSONObject();
                    s.put("id", n.optString("id"));
                    s.put("title", n.optString("title", "Untitled"));
                    s.put("updated", n.optLong("updated"));
                    String text = n.optString("text", "");
                    s.put("preview", text.length() > 120 ? text.substring(0, 120) : text);
                    JSONArray ph = n.optJSONArray("photos");
                    s.put("photos", ph == null ? 0 : ph.length());
                    out.add(s);
                } catch (Exception ignored) {
                }
            }
        }
        out.sort((a, b) -> Long.compare(b.optLong("updated"), a.optLong("updated")));
        return new JSONArray(out);
    }

    private AgentServer.Response note(AgentServer.Request r, String id) throws Exception {
        File f = new File(notes, id + ".json");
        if (r.method.equals("GET")) {
            if (!f.exists()) return AgentServer.Response.error(404, "No such note");
            return new AgentServer.Response(200, "application/json", readAll(new FileInputStream(f)));
        }
        if (r.method.equals("POST")) {
            JSONObject n;
            try {
                n = new JSONObject(new String(r.body, StandardCharsets.UTF_8));
            } catch (Exception e) {
                return AgentServer.Response.error(400, "The note did not arrive whole; nothing was changed");
            }
            n.put("id", id);
            long now = System.currentTimeMillis();
            n.put("updated", now);
            notes.mkdirs();
            try (FileOutputStream o = new FileOutputStream(f)) {
                o.write(n.toString().getBytes(StandardCharsets.UTF_8));
            }
            return AgentServer.Response.json(new JSONObject().put("ok", true).put("updated", now));
        }
        if (r.method.equals("DELETE")) {
            f.delete();
            return AgentServer.Response.json(new JSONObject().put("ok", true));
        }
        return AgentServer.Response.error(405, "Method not allowed");
    }

    // ------------------------------------------------------------------ photos

    private File photo(String name) {
        return PHOTO.matcher(name).matches() ? new File(photos, name) : null;
    }

    private JSONArray listPhotos() throws Exception {
        List<File> fs = new ArrayList<>();
        File[] all = photos.listFiles();
        if (all != null) for (File f : all) if (PHOTO.matcher(f.getName()).matches()) fs.add(f);
        fs.sort((a, b) -> Long.compare(b.lastModified(), a.lastModified()));
        JSONArray out = new JSONArray();
        for (File f : fs) out.put(new JSONObject().put("name", f.getName()).put("url", "/api/space/photo/" + f.getName()).put("time", f.lastModified()));
        return out;
    }

    private AgentServer.Response savePhoto(String b64) throws Exception {
        byte[] buf = Base64.decode(b64, Base64.DEFAULT);
        if (buf.length < 100 || (buf[0] & 0xff) != 0xff || (buf[1] & 0xff) != 0xd8) return AgentServer.Response.error(400, "Not a JPEG");
        photos.mkdirs();
        String name = "utsushi-" + new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(new Date()) + ".jpg";
        try (FileOutputStream o = new FileOutputStream(new File(photos, name))) {
            o.write(buf);
        }
        return AgentServer.Response.json(new JSONObject().put("name", name).put("url", "/api/space/photo/" + name));
    }

    // ------------------------------------------------------------------ models and scans

    private File model(String name) {
        return MODEL.matcher(name).matches() && !name.contains("..") ? new File(models, name) : null;
    }

    private JSONArray listModels() throws Exception {
        List<File> fs = new ArrayList<>();
        File[] all = models.listFiles();
        if (all != null) for (File f : all) if (MODEL.matcher(f.getName()).matches()) fs.add(f);
        fs.sort((a, b) -> Long.compare(b.lastModified(), a.lastModified()));
        JSONArray out = new JSONArray();
        for (File f : fs) {
            String n = f.getName();
            out.put(new JSONObject()
                    .put("file", n)
                    .put("name", n.replaceAll("\\.[^.]+$", ""))
                    .put("format", n.substring(n.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT))
                    .put("url", "/api/space/model/" + java.net.URLEncoder.encode(n, "UTF-8").replace("+", "%20"))
                    .put("bytes", f.length())
                    .put("time", f.lastModified())
                    .put("scan", n.startsWith("scan-")));
        }
        return out;
    }

    private AgentServer.Response modelFile(String name) throws Exception {
        File f = model(name);
        if (f == null || !f.exists()) return AgentServer.Response.error(404, "No such model");
        return new AgentServer.Response(200, "application/octet-stream", readAll(new FileInputStream(f)));
    }

    private AgentServer.Response saveScan(String b64) throws Exception {
        byte[] buf = Base64.decode(b64, Base64.DEFAULT);
        if (buf.length < 64 || !new String(Arrays.copyOf(buf, 3), StandardCharsets.US_ASCII).equals("ply")) return AgentServer.Response.error(400, "Not a PLY scan");
        models.mkdirs();
        String file = "scan-" + new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(new Date()) + ".ply";
        try (FileOutputStream o = new FileOutputStream(new File(models, file))) {
            o.write(buf);
        }
        return AgentServer.Response.json(new JSONObject().put("file", file).put("url", "/api/space/model/" + file).put("bytes", buf.length));
    }
}
