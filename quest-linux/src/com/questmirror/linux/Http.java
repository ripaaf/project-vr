package com.questmirror.linux;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** A very small HTTP server on 127.0.0.1:8771, for UTSUSHI only (it must send the token). */
final class Http {
    static final int PORT = 8771;
    private static boolean started;
    private static final ExecutorService POOL = Executors.newFixedThreadPool(8);

    private Http() {
    }

    static synchronized void start() {
        if (started) return;
        started = true;
        new Thread(() -> {
            try (ServerSocket ss = new ServerSocket(PORT, 16, InetAddress.getByName("127.0.0.1"))) {
                while (true) {
                    Socket s = ss.accept();
                    POOL.execute(() -> serve(s));
                }
            } catch (Exception e) {
                synchronized (Http.class) {
                    started = false;
                }
            }
        }, "linux-http").start();
    }

    private static void serve(Socket s) {
        try (Socket sock = s) {
            sock.setSoTimeout(30000);
            InputStream in = new BufferedInputStream(sock.getInputStream());
            String first = line(in);
            if (first == null) return;
            String[] parts = first.split(" ");
            if (parts.length < 2) return;
            String method = parts[0];
            String target = parts[1];
            Map<String, String> headers = new HashMap<>();
            for (String h; (h = line(in)) != null && !h.isEmpty(); ) {
                int c = h.indexOf(':');
                if (c > 0) headers.put(h.substring(0, c).trim().toLowerCase(Locale.ROOT), h.substring(c + 1).trim());
            }
            int length = 0;
            try {
                length = Integer.parseInt(headers.getOrDefault("content-length", "0"));
            } catch (Exception ignored) {
            }
            if (length < 0 || length > 256 * 1024) {
                reply(sock, 413, error("Too large"));
                return;
            }
            byte[] body = new byte[length];
            for (int got = 0; got < length; ) {
                int n = in.read(body, got, length - got);
                if (n < 0) break;
                got += n;
            }
            String path = target;
            Map<String, String> query = new HashMap<>();
            int qi = target.indexOf('?');
            if (qi >= 0) {
                path = target.substring(0, qi);
                for (String kv : target.substring(qi + 1).split("&")) {
                    int e = kv.indexOf('=');
                    if (e > 0) query.put(URLDecoder.decode(kv.substring(0, e), "UTF-8"), URLDecoder.decode(kv.substring(e + 1), "UTF-8"));
                }
            }
            String tok = LinuxService.token;
            if (tok == null || !same(tok, headers.get("x-token"))) {
                reply(sock, 401, error("Not for you"));
                return;
            }
            JSONObject b = body.length == 0 ? new JSONObject() : new JSONObject(new String(body, StandardCharsets.UTF_8));
            Object out;
            try {
                out = route(method, path, query, b);
            } catch (IllegalStateException e) {
                reply(sock, 409, error(e.getMessage()));
                return;
            } catch (Exception e) {
                reply(sock, 500, error(e.getMessage() == null ? e.toString() : e.getMessage()));
                return;
            }
            if (out == null) reply(sock, 404, error("Not found"));
            else reply(sock, 200, out.toString());
        } catch (Exception ignored) {
        }
    }

    private static Object route(String method, String path, Map<String, String> q, JSONObject b) throws Exception {
        boolean post = method.equals("POST");
        switch (path) {
            case "/state":
                return Linux.state();
            case "/install":
                if (!post) return null;
                Linux.install();
                return Linux.state();
            case "/remove":
                if (!post) return null;
                Linux.remove();
                return Linux.state();
            case "/shell":
                if (!post) return null;
                return new JSONObject().put("id", Linux.open());
            case "/shell/read": {
                int since;
                try {
                    since = Integer.parseInt(q.getOrDefault("since", "0"));
                } catch (Exception e) {
                    since = 0;
                }
                return Linux.read(q.getOrDefault("id", ""), since);
            }
            case "/shell/input":
                if (!post) return null;
                if (!Linux.input(b.optString("id"), b.optString("line"))) throw new IllegalStateException("Shell ended");
                return new JSONObject().put("ok", true);
            case "/shell/close":
                if (!post) return null;
                Linux.close(b.optString("id"));
                return new JSONObject().put("ok", true);
            default:
                return null;
        }
    }

    /** Compares in constant time. */
    private static boolean same(String a, String b) {
        return b != null && MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }

    private static String error(String m) {
        try {
            return new JSONObject().put("error", m).toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    private static void reply(Socket s, int code, String json) throws Exception {
        byte[] b = json.getBytes(StandardCharsets.UTF_8);
        OutputStream o = s.getOutputStream();
        o.write(("HTTP/1.1 " + code + " X\r\nContent-Type: application/json\r\nContent-Length: " + b.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
        o.write(b);
        o.flush();
    }

    private static String line(InputStream in) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) >= 0) {
            if (c == '\n') break;
            if (c != '\r') b.write(c);
            if (b.size() > 8192) return null;
        }
        if (c < 0 && b.size() == 0) return null;
        return b.toString("UTF-8");
    }
}
