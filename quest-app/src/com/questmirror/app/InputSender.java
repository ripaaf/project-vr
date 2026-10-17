package com.questmirror.app;

import android.util.Log;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * Sends mouse/keyboard commands to the PC over one long-lived chunked HTTP request,
 * so every pinch or cursor move costs a few bytes instead of a new connection.
 * Falls back through the PC's addresses, and stops for good if the PC refuses us (unlinked).
 */
final class InputSender {
    private static final String TAG = "QuestMirror";
    private final String[] bases;
    private final String token;
    private final LinkedBlockingQueue<String> queue = new LinkedBlockingQueue<>(2000);
    private volatile boolean running = true;
    private volatile String pendingMove; // only the latest cursor position matters
    private int idx;

    InputSender(String[] bases, String token) {
        this.bases = bases;
        this.token = token;
        Thread t = new Thread(this::loop, "pc-input");
        t.setDaemon(true);
        t.start();
    }

    void send(String cmd) {
        if (running) queue.offer(cmd);
    }

    /** Cursor moves are coalesced: if several arrive before we write, only the last is sent. */
    void move(String cmd) {
        pendingMove = cmd;
        queue.offer("");
    }

    void close() {
        running = false;
        queue.offer("");
    }

    private void loop() {
        while (running) {
            String base = bases[idx % bases.length];
            try (Socket s = new Socket()) {
                URL u = new URL(base);
                s.connect(new InetSocketAddress(u.getHost(), u.getPort() > 0 ? u.getPort() : 80), 3000);
                s.setTcpNoDelay(true);
                OutputStream out = s.getOutputStream();
                String head = "POST /api/pc/input HTTP/1.1\r\n"
                        + "Host: " + u.getHost() + "\r\n"
                        + "Content-Type: text/plain\r\n"
                        + "Transfer-Encoding: chunked\r\n"
                        + (token != null ? "X-QM-Token: " + token + "\r\n" : "")
                        + "\r\n";
                out.write(head.getBytes(StandardCharsets.US_ASCII));
                out.flush();
                // A refused request is answered at once; an accepted one stays open and silent.
                s.setSoTimeout(500);
                try {
                    InputStream in = s.getInputStream();
                    byte[] b = new byte[64];
                    int n = in.read(b);
                    String reply = n > 0 ? new String(b, 0, n, StandardCharsets.US_ASCII) : "";
                    if (reply.startsWith("HTTP/1.1 401") || reply.startsWith("HTTP/1.1 403")) {
                        Log.w(TAG, "input refused by the PC (unlinked?)");
                        running = false;
                        return;
                    }
                    throw new IOException("unexpected reply: " + reply.split("\r\n")[0]);
                } catch (SocketTimeoutException fine) {
                    s.setSoTimeout(0);
                }
                while (running) {
                    String cmd = queue.poll(5, TimeUnit.SECONDS);
                    StringBuilder batch = new StringBuilder();
                    String mv = pendingMove;
                    if (mv != null) {
                        pendingMove = null;
                        batch.append(mv).append('\n');
                    }
                    if (cmd != null && !cmd.isEmpty()) batch.append(cmd).append('\n');
                    String more;
                    while ((more = queue.poll()) != null) if (!more.isEmpty()) batch.append(more).append('\n');
                    if (batch.length() == 0) batch.append("\n"); // keep-alive
                    byte[] data = batch.toString().getBytes(StandardCharsets.UTF_8);
                    out.write((Integer.toHexString(data.length) + "\r\n").getBytes(StandardCharsets.US_ASCII));
                    out.write(data);
                    out.write("\r\n".getBytes(StandardCharsets.US_ASCII));
                    out.flush();
                }
                out.write("0\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                out.flush();
            } catch (IOException | InterruptedException e) {
                if (running) {
                    Log.w(TAG, "input channel via " + base + ": " + e);
                    idx++; // try the next address
                    try {
                        Thread.sleep(800);
                    } catch (InterruptedException ignored) {
                    }
                }
            }
        }
    }
}
