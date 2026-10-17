package com.questmirror.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.wifi.WifiManager;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Finds and talks to the Quest Mirror host on the PC. Tries the ADB tunnel (127.0.0.1) and
 * the PC's Wi-Fi address (remembered, or announced by the PC over UDP broadcast).
 */
final class HostClient {
    private static final String TAG = "QuestMirror";
    static final int PORT = 8765;
    static final int DISCOVERY_PORT = 8767;
    static final String LOCAL = "http://127.0.0.1:" + PORT;

    private static HostClient instance;

    private final SharedPreferences prefs;
    private final Context app;
    private final Set<String> discovered = ConcurrentHashMap.newKeySet();
    private final java.util.Map<String, String> names = new ConcurrentHashMap<>(); // base -> PC name
    private final java.util.Map<String, Long> seenAt = new ConcurrentHashMap<>();
    volatile String base;       // the address that answered last
    volatile String lanBase;    // best direct Wi-Fi address of the PC, if known
    volatile String hostName = "";
    private volatile boolean discovering;

    static synchronized HostClient get(Context c) {
        if (instance == null) instance = new HostClient(c.getApplicationContext());
        return instance;
    }

    private HostClient(Context c) {
        app = c;
        prefs = c.getSharedPreferences("questmirror", Context.MODE_PRIVATE);
        lanBase = prefs.getString("lanBase", null);
        hostName = prefs.getString("hostName", "");
    }

    String token() {
        return prefs.getString("token", null);
    }

    void saveToken(String token, String name) {
        // Linking on purpose also re-allows automatic linking over the cable.
        prefs.edit().putString("token", token).putString("hostName", name == null ? "" : name).putBoolean("noAutoLink", false).apply();
        if (name != null) hostName = name;
    }

    /** After the user unlinks, don't silently link again over the cable. */
    private boolean autoLinkAllowed() {
        return !prefs.getBoolean("noAutoLink", false);
    }

    void saveLanBase(String b) {
        lanBase = b;
        prefs.edit().putString("lanBase", b).apply();
    }

    String manualAddress() {
        return prefs.getString("manual", "");
    }

    void setManualAddress(String addr) {
        addr = addr.trim();
        prefs.edit().putString("manual", addr).apply();
    }

    static String normalize(String addr) {
        addr = addr.trim();
        if (addr.isEmpty()) return null;
        if (!addr.startsWith("http://") && !addr.startsWith("https://")) addr = "http://" + addr;
        if (!addr.substring(addr.indexOf("//") + 2).contains(":")) addr = addr + ":" + PORT;
        return addr.endsWith("/") ? addr.substring(0, addr.length() - 1) : addr;
    }

    List<String> candidates() {
        List<String> list = new ArrayList<>();
        String manual = normalize(manualAddress());
        if (manual != null) list.add(manual);
        if (lanBase != null && !list.contains(lanBase)) list.add(lanBase);
        long now = System.currentTimeMillis();
        for (String d : discovered) {
            Long seen = seenAt.get(d);
            boolean fresh = seen == null ? statusLan.contains(d) : now - seen < 30000; // skip PCs from an old network
            if (fresh && !list.contains(d)) list.add(d);
        }
        list.add(LOCAL);
        return list;
    }

    /** Polls the host status, trying every known address; remembers which one works. */
    JSONObject status() {
        List<String> order = new ArrayList<>();
        if (base != null) order.add(base);
        for (String c : candidates()) if (!order.contains(c)) order.add(c);
        for (String b : order) {
            try {
                JSONObject s = request(b, "GET", "/api/status", null, 1500);
                base = b;
                hostName = s.optString("hostName", hostName);
                // Over the ADB tunnel we're trusted: fetch the pairing token automatically
                // (unless the user unlinked on purpose).
                if (b.equals(LOCAL) && token() == null && autoLinkAllowed()) {
                    try {
                        JSONObject t = request(b, "GET", "/api/pc/token", null, 3000);
                        saveToken(t.getString("token"), t.optString("hostName"));
                    } catch (Exception ignored) {
                    }
                }
                if (!b.equals(LOCAL) && token() != null) saveLanBase(b);
                // The PC's Wi-Fi address can change (new network); re-check it now and then.
                if (b.equals(LOCAL) && token() != null && System.currentTimeMillis() - lanCheckedAt > 10000) {
                    lanCheckedAt = System.currentTimeMillis();
                    learnLanFromStatus(s);
                    probeLan();
                }
                return s;
            } catch (Exception e) {
                if (b.equals(base)) base = null;
            }
        }
        return null;
    }

    private volatile long lanCheckedAt;
    private final List<String> statusLan = new java.util.concurrent.CopyOnWriteArrayList<>();

    /** The PC tells us its current LAN addresses; those beat anything remembered. */
    private void learnLanFromStatus(JSONObject s) {
        statusLan.clear();
        try {
            org.json.JSONArray urls = s.getJSONArray("urls");
            for (int i = 0; i < urls.length(); i++) {
                JSONObject u = urls.getJSONObject(i);
                if (!u.optBoolean("virtual")) statusLan.add(u.getString("url"));
            }
        } catch (Exception ignored) {
        }
    }

    /** While on the ADB tunnel, find which Wi-Fi address of the PC really answers (or forget a stale one). */
    private void probeLan() {
        if (token() == null) return;
        List<String> tries = new ArrayList<>(statusLan);
        for (String d : discovered) if (!tries.contains(d)) tries.add(d);
        if (lanBase != null && !tries.contains(lanBase)) tries.add(lanBase);
        for (String d : tries) {
            try {
                request(d, "GET", "/api/pc/monitors", null, 1500);
                if (!d.equals(lanBase)) Log.i(TAG, "PC Wi-Fi address is now " + d);
                saveLanBase(d);
                return;
            } catch (Exception ignored) {
            }
        }
        if (lanBase != null) Log.i(TAG, "PC Wi-Fi address " + lanBase + " no longer answers");
        lanBase = null;
        prefs.edit().remove("lanBase").apply();
    }

    /** Ways to reach the PC for video/sound/input, best first; streams fall back down the list. */
    String[] streamBases() {
        List<String> out = new ArrayList<>();
        String b = base;
        if (b != null && !b.equals(LOCAL)) out.add(b);
        if (lanBase != null && !out.contains(lanBase)) out.add(lanBase);
        for (String s : statusLan) if (!out.contains(s)) out.add(s);
        if (!out.contains(LOCAL)) out.add(LOCAL);
        return out.toArray(new String[0]);
    }

    JSONObject get(String path) throws IOException {
        if (base == null) throw new IOException("PC not found");
        return request(base, "GET", path, null, 4000);
    }

    JSONObject post(String path, JSONObject body) throws IOException {
        if (base == null) throw new IOException("PC not found");
        return request(base, "POST", path, body, 30000);
    }

    /** PCs heard on this Wi-Fi in the last 10 s, as {base, name}. */
    List<String[]> nearbyPcs() {
        List<String[]> out = new ArrayList<>();
        long now = System.currentTimeMillis();
        for (String b : discovered) {
            Long t = seenAt.get(b);
            if (t != null && now - t < 10000) out.add(new String[]{b, names.containsKey(b) ? names.get(b) : ""});
        }
        String manual = normalize(manualAddress());
        if (manual != null && !discovered.contains(manual)) out.add(new String[]{manual, ""});
        return out;
    }

    /** One-tap pairing: ask the PC; the owner clicks Allow there. Returns {id, check, hostName}. */
    JSONObject requestPair(String b, String device) throws IOException {
        JSONObject body = new JSONObject();
        try {
            body.put("device", device);
        } catch (Exception ignored) {
        }
        return request(b, "POST", "/api/pc/pair-request", body, 4000);
    }

    /** Polls a pairing request; on approval stores the token and remembers that PC. */
    String pollPair(String b, String id) throws IOException {
        JSONObject r = request(b, "GET", "/api/pc/pair-request?id=" + id, null, 4000);
        String state = r.optString("state");
        if ("approved".equals(state)) {
            saveToken(r.optString("token"), r.optString("hostName"));
            base = b;
            if (!b.equals(LOCAL)) saveLanBase(b);
        }
        return state;
    }

    /** Pair with a code at a known address (from a scanned QR). */
    JSONObject pairAt(String b, String code) throws IOException {
        JSONObject body = new JSONObject();
        try {
            body.put("code", code);
        } catch (Exception ignored) {
        }
        JSONObject r = request(b, "POST", "/api/pc/pair", body, 5000);
        String token = r.optString("token");
        if (token.isEmpty()) throw new IOException("PC did not send a token");
        saveToken(token, r.optString("hostName"));
        base = b;
        if (!b.equals(LOCAL)) saveLanBase(b);
        return r;
    }

    /** Forget the paired PC. Stays unlinked (no automatic re-link over the cable) until the user links again. */
    void forget() {
        prefs.edit().remove("token").remove("lanBase").remove("hostName").putBoolean("noAutoLink", true).apply();
        lanBase = null;
        hostName = "";
    }

    /** Unlink for real: ask the PC to revoke access (kills open streams there too), then forget locally. */
    void unlink() {
        String b = base;
        if (b != null && token() != null) {
            try {
                request(b, "POST", "/api/pc/unlink", new JSONObject(), 4000);
            } catch (Exception e) {
                Log.w(TAG, "PC could not be told about the unlink: " + e.getMessage());
            }
        }
        forget();
    }

    JSONObject pair(String code) throws IOException {
        List<String> order = new ArrayList<>();
        if (base != null) order.add(base);
        for (String c : candidates()) if (!order.contains(c)) order.add(c);
        IOException last = new IOException("Can't find your PC on this Wi-Fi. Type its address below.");
        for (String b : order) {
            try {
                JSONObject body = new JSONObject();
                body.put("code", code);
                JSONObject r = request(b, "POST", "/api/pc/pair", body, 4000);
                saveToken(r.getString("token"), r.optString("hostName"));
                base = b;
                if (!b.equals(LOCAL)) saveLanBase(b);
                return r;
            } catch (HttpError e) {
                throw new IOException(e.getMessage());
            } catch (Exception e) {
                last = new IOException(e.getMessage());
            }
        }
        throw last;
    }

    static final class HttpError extends IOException {
        final int code;

        HttpError(int code, String msg) {
            super(msg);
            this.code = code;
        }
    }

    JSONObject request(String b, String method, String path, JSONObject body, int timeout) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(b + path).openConnection();
        c.setConnectTimeout(Math.min(timeout, 2500));
        c.setReadTimeout(timeout);
        c.setRequestMethod(method);
        String t = token();
        if (t != null) c.setRequestProperty("X-QM-Token", t);
        try {
            if (body != null) {
                byte[] data = body.toString().getBytes(StandardCharsets.UTF_8);
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                c.setFixedLengthStreamingMode(data.length);
                try (OutputStream o = c.getOutputStream()) {
                    o.write(data);
                }
            }
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String text = in == null ? "" : readAll(in);
            if (code >= 400) {
                String msg = "Error " + code;
                try {
                    msg = new JSONObject(text).optString("error", msg);
                } catch (Exception ignored) {
                }
                throw new HttpError(code, msg);
            }
            try {
                return text.isEmpty() ? new JSONObject() : new JSONObject(text);
            } catch (Exception e) {
                throw new IOException("Bad response");
            }
        } finally {
            c.disconnect();
        }
    }

    static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toString("UTF-8");
    }

    /** Listens for the PC's UDP announcements so the user never has to type an IP address. */
    void startDiscovery() {
        if (discovering) return;
        discovering = true;
        Thread t = new Thread(() -> {
            WifiManager wm = (WifiManager) app.getSystemService(Context.WIFI_SERVICE);
            WifiManager.MulticastLock lock = null;
            try {
                // Some Wi-Fi drivers drop broadcast packets unless this lock is held.
                lock = wm != null ? wm.createMulticastLock("questmirror") : null;
                if (lock != null) {
                    lock.setReferenceCounted(false);
                    lock.acquire();
                }
            } catch (Exception e) {
                Log.w(TAG, "no multicast lock: " + e.getMessage());
                lock = null;
            }
            try (DatagramSocket s = new DatagramSocket(null)) {
                s.setReuseAddress(true);
                s.setBroadcast(true);
                s.bind(new InetSocketAddress(DISCOVERY_PORT));
                byte[] buf = new byte[1024];
                while (discovering) {
                    DatagramPacket p = new DatagramPacket(buf, buf.length);
                    s.receive(p);
                    try {
                        JSONObject o = new JSONObject(new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8));
                        if (!"quest-mirror".equals(o.optString("app"))) continue;
                        String b = "http://" + p.getAddress().getHostAddress() + ":" + o.optInt("port", PORT);
                        names.put(b, o.optString("name", ""));
                        seenAt.put(b, System.currentTimeMillis());
                        if (discovered.add(b)) Log.i(TAG, "found PC " + o.optString("name") + " at " + b);
                    } catch (Exception ignored) {
                    }
                }
            } catch (IOException e) {
                Log.w(TAG, "discovery stopped: " + e.getMessage());
            } finally {
                if (lock != null && lock.isHeld()) lock.release();
                discovering = false;
            }
        }, "discovery");
        t.setDaemon(true);
        t.start();
    }
}
