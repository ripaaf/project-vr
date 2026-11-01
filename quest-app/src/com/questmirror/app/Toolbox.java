package com.questmirror.app;

import android.content.Context;
import android.system.Os;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;

/**
 * The Linux toolbox for the Terminal: BusyBox built for Android (Termux's build: it never asks for
 * setuid, which the app sandbox forbids) travels inside the app as libbusybox.so with its libraries —
 * the one place Android lets an app run its own programs from — and a folder of links (ls, vi, wget,
 * awk, tar, nc, httpd …) points at it. That folder goes first on PATH.
 */
final class Toolbox {
    private Toolbox() {
    }

    /** The folder of links (made the first time, and again after an update); empty when not bundled. */
    static synchronized String ensure(Context ctx) {
        File bb = new File(ctx.getApplicationInfo().nativeLibraryDir, "libbusybox.so");
        File bin = new File(ctx.getFilesDir(), "toolbox/bin");
        bin.mkdirs();
        if (!bb.exists()) return bin.getPath();
        File stamp = new File(bin, ".ready-" + bb.length() + "-" + bb.lastModified());
        if (stamp.exists()) return bin.getPath();
        try {
            File[] old = bin.listFiles();
            if (old != null) for (File f : old) f.delete();
            // BusyBox picks the tool from the name it is called by: ask it through a link named busybox
            File self = new File(bin, "busybox");
            Os.symlink(bb.getPath(), self.getPath());
            ProcessBuilder pb = new ProcessBuilder(self.getPath(), "--list").redirectErrorStream(true);
            pb.environment().put("LD_LIBRARY_PATH", ctx.getApplicationInfo().nativeLibraryDir);
            Process p = pb.start();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
                String name;
                while ((name = r.readLine()) != null) {
                    name = name.trim();
                    if (name.isEmpty() || name.contains("/") || name.equals("busybox")) continue;
                    try {
                        Os.symlink(bb.getPath(), new File(bin, name).getPath());
                    } catch (Exception ignored) {
                    }
                }
            }
            p.waitFor();
            stamp.createNewFile();
        } catch (Exception ignored) {
        }
        return bin.getPath();
    }
}
