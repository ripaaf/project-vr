package com.questmirror.app;

import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Minimal HTTP/1.1 server bound to the headset's loopback interface. The PC reaches it
 * through `adb forward`, so nothing on the Wi-Fi network can talk to it directly.
 */
final class AgentServer {
    private static final String TAG = "QuestMirror";

    interface Handler {
        Response handle(Request req) throws Exception;
    }

    static final class Request {
        String method;
        String path;
        final Map<String, String> query = new HashMap<>();
        final Map<String, String> headers = new HashMap<>(); // lower-case names
        byte[] body = new byte[0];

        JSONObject json() {
            try {
                return body.length == 0 ? new JSONObject() : new JSONObject(new String(body, StandardCharsets.UTF_8));
            } catch (Exception e) {
                return new JSONObject();
            }
        }

        String q(String key, String def) {
            String v = query.get(key);
            return v == null ? def : v;
        }
    }

    static final class Response {
        final int code;
        final String type;
        final byte[] body;
        String extra = ""; // more header lines, each ending in \r\n
        java.io.File file; // sent from disk instead of body (big files)

        Response(int code, String type, byte[] body) {
            this.code = code;
            this.type = type;
            this.body = body;
        }

        static Response file(java.io.File f, String type) {
            Response r = new Response(200, type, new byte[0]);
            r.file = f;
            return r;
        }

        static Response json(Object o) {
            return new Response(200, "application/json", o.toString().getBytes(StandardCharsets.UTF_8));
        }

        static Response error(int code, String message) {
            JSONObject o = new JSONObject();
            try {
                o.put("error", message);
            } catch (Exception ignored) {
            }
            return new Response(code, "application/json", o.toString().getBytes(StandardCharsets.UTF_8));
        }
    }

    private final int port;
    private final Handler handler;
    private final int maxBody;
    private final ExecutorService pool = Executors.newFixedThreadPool(16); // some answers wait (pictures, shell output)
    private volatile ServerSocket socket;

    AgentServer(int port, Handler handler) {
        this(port, handler, 1024 * 1024);
    }

    AgentServer(int port, Handler handler, int maxBody) {
        this.port = port;
        this.handler = handler;
        this.maxBody = maxBody;
    }

    synchronized boolean start() {
        if (socket != null) return true;
        try {
            ServerSocket ss = new ServerSocket();
            ss.setReuseAddress(true);
            ss.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port));
            socket = ss;
        } catch (IOException e) {
            Log.w(TAG, "agent port " + port + " busy: " + e.getMessage());
            return false;
        }
        Thread t = new Thread(this::acceptLoop, "agent-accept");
        t.setDaemon(true);
        t.start();
        Log.i(TAG, "agent listening on 127.0.0.1:" + port);
        return true;
    }

    private void acceptLoop() {
        ServerSocket ss = socket;
        while (ss != null && !ss.isClosed()) {
            try {
                final Socket s = ss.accept();
                pool.execute(() -> serve(s));
            } catch (IOException e) {
                if (ss.isClosed()) break;
            }
        }
    }

    private void serve(Socket s) {
        try (Socket sock = s) {
            sock.setSoTimeout(15000);
            InputStream in = new BufferedInputStream(sock.getInputStream());
            Request req = parse(in, maxBody);
            Response res;
            if (req == null) {
                res = Response.error(400, "Bad request");
            } else {
                try {
                    res = handler.handle(req);
                } catch (SecurityException e) {
                    res = Response.error(403, e.getMessage());
                } catch (IllegalArgumentException e) {
                    res = Response.error(400, e.getMessage());
                } catch (Exception e) {
                    Log.w(TAG, "handler failed: " + req.path, e);
                    res = Response.error(500, e.getMessage() == null ? e.toString() : e.getMessage());
                }
            }
            OutputStream out = sock.getOutputStream();
            long length = res.file != null ? res.file.length() : res.body.length;
            String head = "HTTP/1.1 " + res.code + " " + (res.code < 400 ? "OK" : "Error") + "\r\n"
                    + "Content-Type: " + res.type + "\r\n"
                    + "Content-Length: " + length + "\r\n"
                    + "Cache-Control: no-store\r\n"
                    + res.extra
                    + "Connection: close\r\n\r\n";
            out.write(head.getBytes(StandardCharsets.US_ASCII));
            if (res.file != null) {
                sock.setSoTimeout(0); // a big file may take a while
                try (InputStream fin = new java.io.FileInputStream(res.file)) {
                    byte[] b = new byte[65536];
                    int n;
                    while ((n = fin.read(b)) > 0) out.write(b, 0, n);
                }
            } else out.write(res.body);
            out.flush();
        } catch (IOException ignored) {
        }
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') buf.write(c);
            if (buf.size() > 8192) throw new IOException("line too long");
        }
        if (c == -1 && buf.size() == 0) return null;
        return buf.toString("UTF-8");
    }

    private static Request parse(InputStream in, int maxBody) throws IOException {
        String line = readLine(in);
        if (line == null) return null;
        String[] parts = line.split(" ");
        if (parts.length < 2) return null;
        Request r = new Request();
        r.method = parts[0];
        String target = parts[1];
        int qi = target.indexOf('?');
        r.path = qi >= 0 ? target.substring(0, qi) : target;
        if (qi >= 0) {
            for (String kv : target.substring(qi + 1).split("&")) {
                int eq = kv.indexOf('=');
                if (eq <= 0) continue;
                r.query.put(URLDecoder.decode(kv.substring(0, eq), "UTF-8"), URLDecoder.decode(kv.substring(eq + 1), "UTF-8"));
            }
        }
        int length = 0;
        String h;
        while ((h = readLine(in)) != null && !h.isEmpty()) {
            int colon = h.indexOf(':');
            if (colon > 0) r.headers.put(h.substring(0, colon).trim().toLowerCase(java.util.Locale.ROOT), h.substring(colon + 1).trim());
            if (colon > 0 && h.substring(0, colon).trim().equalsIgnoreCase("content-length")) {
                length = Integer.parseInt(h.substring(colon + 1).trim());
            }
        }
        if (length > 0) {
            if (length > maxBody) throw new IOException("body too large");
            byte[] body = new byte[length];
            int read = 0;
            while (read < length) {
                int n = in.read(body, read, length - read);
                if (n < 0) break;
                read += n;
            }
            r.body = body;
        }
        return r;
    }
}
