package com.questmirror.app;

import android.content.Context;
import android.os.SystemClock;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The Terminal when there is no PC: a real shell on the headset, run by this app. Output is kept in
 * order and read by the space a moment at a time (this little server answers, it does not stream).
 * With the toolbox (BusyBox, inside the app) on PATH there are ~300 Linux commands to hand.
 */
final class Shells {
    private static final Map<String, Shell> SHELLS = new HashMap<>();

    private static final class Shell {
        Process proc;
        OutputStream in;
        final List<JSONObject> out = new ArrayList<>();
        int base; // index of out[0] in the whole history (old lines are dropped)
        boolean ended;
        long seenAt = SystemClock.uptimeMillis();
    }

    private Shells() {
    }

    static synchronized String open(Context ctx) throws Exception {
        // shells nobody read for a minute are gone
        for (Map.Entry<String, Shell> e : new ArrayList<>(SHELLS.entrySet()))
            if (SystemClock.uptimeMillis() - e.getValue().seenAt > 60000) close(e.getKey());
        File home = QuestFiles.allowed() ? new File("/sdcard") : ctx.getFilesDir();
        String path = Toolbox.ensure(ctx) + ":/system/bin:/system/xbin:/product/bin:/vendor/bin";
        ProcessBuilder pb = new ProcessBuilder("/system/bin/sh").directory(home);
        pb.environment().put("PATH", path);
        pb.environment().put("LD_LIBRARY_PATH", ctx.getApplicationInfo().nativeLibraryDir); // the toolbox's libraries
        pb.environment().put("HOME", ctx.getFilesDir().getPath());
        pb.environment().put("TERM", "dumb");
        pb.environment().put("PS1", "");
        Shell s = new Shell();
        s.proc = pb.start();
        s.in = s.proc.getOutputStream();
        String id = UUID.randomUUID().toString().substring(0, 8);
        SHELLS.put(id, s);
        pump(s, s.proc.getInputStream(), "out");
        pump(s, s.proc.getErrorStream(), "err");
        new Thread(() -> {
            try {
                s.proc.waitFor();
            } catch (InterruptedException ignored) {
            }
            add(s, "exit", "");
            synchronized (s) {
                s.ended = true;
            }
        }, "shell-wait").start();
        return id;
    }

    private static void pump(Shell s, InputStream is, String kind) {
        new Thread(() -> {
            byte[] b = new byte[8192];
            try {
                int n;
                while ((n = is.read(b)) > 0) add(s, kind, new String(b, 0, n, StandardCharsets.UTF_8));
            } catch (Exception ignored) {
            }
        }, "shell-" + kind).start();
    }

    private static void add(Shell s, String kind, String data) {
        synchronized (s) {
            try {
                s.out.add(new JSONObject().put("kind", kind).put("data", data));
            } catch (Exception ignored) {
            }
            if (s.out.size() > 2000) {
                s.out.subList(0, 500).clear();
                s.base += 500;
            }
            s.notifyAll();
        }
    }

    /** What came out after `since`, waiting up to ~0.8 s for something new. */
    static JSONObject read(String id, int since) throws Exception {
        Shell s;
        synchronized (Shells.class) {
            s = SHELLS.get(id);
        }
        if (s == null) throw new IllegalStateException("Shell ended");
        s.seenAt = SystemClock.uptimeMillis();
        synchronized (s) {
            long until = SystemClock.uptimeMillis() + 800;
            while (s.base + s.out.size() <= since && !s.ended && SystemClock.uptimeMillis() < until) s.wait(Math.max(1, until - SystemClock.uptimeMillis()));
            JSONArray msgs = new JSONArray();
            for (int i = Math.max(0, since - s.base); i < s.out.size(); i++) msgs.put(s.out.get(i));
            return new JSONObject().put("messages", msgs).put("next", s.base + s.out.size()).put("ended", s.ended);
        }
    }

    static boolean input(String id, String line) {
        Shell s;
        synchronized (Shells.class) {
            s = SHELLS.get(id);
        }
        if (s == null) return false;
        try {
            s.in.write((line + "\n").getBytes(StandardCharsets.UTF_8));
            s.in.flush();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    static synchronized void close(String id) {
        Shell s = SHELLS.remove(id);
        if (s != null) s.proc.destroy();
    }
}
