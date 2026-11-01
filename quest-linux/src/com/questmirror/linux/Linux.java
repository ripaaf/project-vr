package com.questmirror.linux;

import android.content.Context;
import android.os.SystemClock;
import android.system.Os;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.zip.GZIPInputStream;

/**
 * Alpine Linux in this app's storage, run with proot (from Termux): a fake root, so its package
 * manager works (apk add python3 …). Installing downloads Alpine's mini root filesystem (~4 MB)
 * straight from alpinelinux.org and checks it against the checksum Alpine publishes.
 */
final class Linux {
    private static final String RELEASES = "https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/aarch64/";
    private static final String[] TOOLS = {"usr/bin/proot", "usr/libexec/proot/loader", "usr/lib/libtalloc.so.2", "usr/lib/libandroid-shmem.so"};

    private static File base, usr, rootfs, tmp;
    private static volatile String phase = "idle"; // idle | downloading | unpacking | failed
    private static volatile long got, total;
    private static volatile String error = "", version = "";

    private Linux() {
    }

    static synchronized void init(Context ctx) {
        if (base != null) return;
        base = ctx.getFilesDir();
        usr = new File(base, "usr");
        rootfs = new File(base, "alpine");
        tmp = new File(base, "tmp");
        tmp.mkdirs();
        // proot and its loader travel in the app; Android 9-era apps may run them from here
        for (String t : TOOLS) {
            File f = new File(base, t);
            try (InputStream in = ctx.getAssets().open(t)) {
                byte[] b = readAll(in);
                if (!f.exists() || f.length() != b.length) {
                    f.getParentFile().mkdirs();
                    try (OutputStream o = new FileOutputStream(f)) {
                        o.write(b);
                    }
                }
                f.setReadable(true, true);
                f.setExecutable(true, true);
            } catch (IOException e) {
                error = "Missing " + t;
            }
        }
        File v = new File(rootfs, ".utsushi-version");
        if (v.exists()) version = text(v).trim();
    }

    static boolean installed() {
        return new File(rootfs, ".utsushi-version").exists();
    }

    static JSONObject state() throws Exception {
        return new JSONObject()
                .put("installed", installed())
                .put("phase", phase)
                .put("got", got)
                .put("total", total)
                .put("version", version)
                .put("error", error)
                .put("bytes", installed() ? sizeOf(rootfs.toPath()) : 0);
    }

    // ------------------------------------------------------------------ install / remove

    static synchronized void install() {
        if (phase.equals("downloading") || phase.equals("unpacking")) return;
        if (installed()) throw new IllegalStateException("Alpine is installed already");
        phase = "downloading";
        error = "";
        got = 0;
        total = 0;
        new Thread(() -> {
            File part = new File(base, "alpine.part");
            File tgz = new File(tmp, "alpine.tar.gz");
            try {
                // which file is the newest mini root filesystem, and its checksum
                String yaml = new String(fetch(RELEASES + "latest-releases.yaml"), StandardCharsets.UTF_8);
                String file = null, sha = null, ver = null;
                for (String block : yaml.split("\n-\n")) {
                    if (!block.contains("flavor: alpine-minirootfs")) continue;
                    for (String l : block.split("\n")) {
                        l = l.trim();
                        if (l.startsWith("file: ")) file = l.substring(6).trim();
                        if (l.startsWith("sha256: ")) sha = l.substring(8).trim();
                        if (l.startsWith("version: ")) ver = l.substring(9).trim();
                    }
                }
                if (file == null || sha == null || !file.matches("[A-Za-z0-9._-]+\\.tar\\.gz")) throw new IOException("Alpine's release list looked different than expected");
                download(RELEASES + file, tgz);
                if (!sha.equalsIgnoreCase(sha256(tgz))) throw new IOException("The download did not match Alpine's checksum");
                phase = "unpacking";
                delete(part.toPath());
                part.mkdirs();
                untar(tgz, part);
                configure(part);
                text(new File(part, ".utsushi-version"), ver == null ? file : ver);
                if (!part.renameTo(rootfs)) throw new IOException("Could not move Alpine into place");
                version = ver == null ? file : ver;
                phase = "idle";
            } catch (Exception e) {
                error = e.getMessage() == null ? e.toString() : e.getMessage();
                phase = "failed";
                try {
                    delete(part.toPath());
                } catch (Exception ignored) {
                }
            } finally {
                tgz.delete();
            }
        }, "linux-install").start();
    }

    /** Everything inside Linux goes (your packages and its /root); links are removed, never followed. */
    static synchronized void remove() throws IOException {
        if (phase.equals("downloading") || phase.equals("unpacking")) throw new IllegalStateException("Still installing");
        synchronized (SHELLS) {
            for (String id : new ArrayList<>(SHELLS.keySet())) close(id);
        }
        delete(rootfs.toPath());
        version = "";
        error = "";
        phase = "idle";
    }

    private static void configure(File root) throws IOException {
        // Android has no /etc/resolv.conf of its own to share: name servers for apk and friends
        text(new File(root, "etc/resolv.conf"), "nameserver 1.1.1.1\nnameserver 8.8.8.8\n");
        text(new File(root, "etc/hosts"), "127.0.0.1 localhost\n::1 localhost\n");
        new File(root, "root").mkdirs();
        File t = new File(root, "tmp");
        t.mkdirs();
        try {
            Os.chmod(t.getPath(), 01777);
        } catch (Exception ignored) {
        }
        text(new File(root, "etc/motd"), "");
        text(new File(root, "etc/profile.d/utsushi.sh"), "export PS1=''\n");
    }

    // ------------------------------------------------------------------ shells (read a moment at a time)

    private static final Map<String, Shell> SHELLS = new HashMap<>();

    private static final class Shell {
        Process proc;
        OutputStream in;
        final List<JSONObject> out = new ArrayList<>();
        int base;
        boolean ended;
        long seenAt = SystemClock.uptimeMillis();
    }

    static String open() throws Exception {
        if (!installed()) throw new IllegalStateException("Alpine is not installed");
        synchronized (SHELLS) {
            for (Map.Entry<String, Shell> e : new ArrayList<>(SHELLS.entrySet()))
                if (SystemClock.uptimeMillis() - e.getValue().seenAt > 60000) close(e.getKey());
        }
        List<String> cmd = new ArrayList<>();
        String r = rootfs.getPath();
        add(cmd, new File(base, "usr/bin/proot").getPath(), "--kill-on-exit", "--link2symlink", "-0", "-r", r,
                "-b", "/dev", "-b", "/proc", "-b", "/sys", "-b", "/dev/urandom:/dev/random", "-b", r + "/tmp:/dev/shm");
        File sd = new File("/storage/emulated/0");
        if (sd.canRead()) add(cmd, "-b", sd.getPath() + ":/sdcard");
        add(cmd, "-w", "/root", "/usr/bin/env", "-i", "HOME=/root", "USER=root", "LANG=C.UTF-8", "TERM=dumb",
                "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "/bin/sh");
        ProcessBuilder pb = new ProcessBuilder(cmd).directory(base);
        Map<String, String> env = pb.environment();
        env.put("PROOT_TMP_DIR", tmp.getPath());
        env.put("PROOT_LOADER", new File(base, "usr/libexec/proot/loader").getPath());
        env.put("LD_LIBRARY_PATH", new File(base, "usr/lib").getPath());
        Shell s = new Shell();
        s.proc = pb.start();
        s.in = s.proc.getOutputStream();
        String id = UUID.randomUUID().toString().substring(0, 8);
        synchronized (SHELLS) {
            SHELLS.put(id, s);
        }
        pump(s, s.proc.getInputStream(), "out");
        pump(s, s.proc.getErrorStream(), "err");
        new Thread(() -> {
            try {
                s.proc.waitFor();
            } catch (InterruptedException ignored) {
            }
            push(s, "exit", "");
            synchronized (s) {
                s.ended = true;
            }
        }, "linux-wait").start();
        return id;
    }

    private static void add(List<String> l, String... more) {
        for (String m : more) l.add(m);
    }

    private static void pump(Shell s, InputStream is, String kind) {
        new Thread(() -> {
            byte[] b = new byte[8192];
            try {
                int n;
                while ((n = is.read(b)) > 0) push(s, kind, new String(b, 0, n, StandardCharsets.UTF_8));
            } catch (Exception ignored) {
            }
        }, "linux-" + kind).start();
    }

    private static void push(Shell s, String kind, String data) {
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

    static JSONObject read(String id, int since) throws Exception {
        Shell s;
        synchronized (SHELLS) {
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
        synchronized (SHELLS) {
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

    static void close(String id) {
        Shell s;
        synchronized (SHELLS) {
            s = SHELLS.remove(id);
        }
        if (s != null) s.proc.destroy();
    }

    // ------------------------------------------------------------------ files

    private static byte[] fetch(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        try (InputStream in = c.getInputStream()) {
            if (c.getResponseCode() != 200) throw new IOException("alpinelinux.org answered " + c.getResponseCode());
            return readAll(in);
        } finally {
            c.disconnect();
        }
    }

    private static void download(String url, File to) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        try (InputStream in = c.getInputStream(); OutputStream o = new FileOutputStream(to)) {
            if (c.getResponseCode() != 200) throw new IOException("alpinelinux.org answered " + c.getResponseCode());
            total = c.getContentLengthLong();
            byte[] b = new byte[64 * 1024];
            for (int n; (n = in.read(b)) > 0; ) {
                o.write(b, 0, n);
                got += n;
            }
        } finally {
            c.disconnect();
        }
    }

    /** A tar.gz (GNU/ustar: files, folders, links), kept strictly inside `to`. */
    private static void untar(File tgz, File to) throws Exception {
        try (InputStream in = new GZIPInputStream(new FileInputStream(tgz), 64 * 1024)) {
            byte[] h = new byte[512];
            String longName = null;
            while (readFully(in, h)) {
                boolean empty = true;
                for (byte x : h) if (x != 0) {
                    empty = false;
                    break;
                }
                if (empty) break;
                String name = str(h, 0, 100);
                String prefix = str(h, 345, 155);
                if (!prefix.isEmpty() && h[257] == 'u' && h[262] == 0) name = prefix + "/" + name; // POSIX ustar
                if (longName != null) {
                    name = longName;
                    longName = null;
                }
                long size = oct(h, 124, 12);
                int mode = (int) oct(h, 100, 8);
                char type = h[156] == 0 ? '0' : (char) h[156];
                String link = str(h, 157, 100);
                long padded = (size + 511) / 512 * 512;
                if (type == 'L') {
                    byte[] b = new byte[(int) padded];
                    readFully(in, b);
                    longName = new String(b, 0, (int) size, StandardCharsets.UTF_8).replace("\0", "");
                    continue;
                }
                while (name.startsWith("./")) name = name.substring(2);
                if (name.isEmpty() || name.equals(".")) {
                    skip(in, padded);
                    continue;
                }
                File f = inside(to, name);
                switch (type) {
                    case '5':
                        f.mkdirs();
                        chmod(f, mode | 0700);
                        skip(in, padded);
                        break;
                    case '2':
                        f.getParentFile().mkdirs();
                        f.delete();
                        Os.symlink(link, f.getPath()); // links resolve inside Linux (proot), never here
                        skip(in, padded);
                        break;
                    case '1': {
                        File src = inside(to, link.startsWith("./") ? link.substring(2) : link);
                        f.getParentFile().mkdirs();
                        Files.copy(src.toPath(), f.toPath());
                        skip(in, padded);
                        break;
                    }
                    case '0':
                    case '7': {
                        f.getParentFile().mkdirs();
                        try (OutputStream o = new FileOutputStream(f)) {
                            byte[] b = new byte[64 * 1024];
                            long left = size;
                            while (left > 0) {
                                int n = in.read(b, 0, (int) Math.min(b.length, left));
                                if (n < 0) throw new IOException("The archive ended early");
                                o.write(b, 0, n);
                                left -= n;
                            }
                        }
                        skip(in, padded - size);
                        chmod(f, mode | 0600);
                        break;
                    }
                    default:
                        skip(in, padded); // devices, fifos, extended headers: not needed here
                }
            }
        }
    }

    /** `name` under `to`, refusing anything that could land outside it (.., absolute, through a link). */
    private static File inside(File to, String name) throws IOException {
        if (name.startsWith("/") || ("/" + name + "/").contains("/../")) throw new IOException("Unsafe path in the archive: " + name);
        File f = new File(to, name);
        for (File d = f.getParentFile(); d != null && !d.equals(to); d = d.getParentFile())
            if (Files.isSymbolicLink(d.toPath())) throw new IOException("Unsafe path in the archive: " + name);
        return f;
    }

    private static void chmod(File f, int mode) {
        try {
            Os.chmod(f.getPath(), mode & 07777);
        } catch (Exception ignored) {
        }
    }

    private static boolean readFully(InputStream in, byte[] b) throws IOException {
        int got = 0;
        while (got < b.length) {
            int n = in.read(b, got, b.length - got);
            if (n < 0) return false;
            got += n;
        }
        return true;
    }

    private static void skip(InputStream in, long n) throws IOException {
        byte[] b = new byte[8192];
        while (n > 0) {
            int r = in.read(b, 0, (int) Math.min(b.length, n));
            if (r < 0) return;
            n -= r;
        }
    }

    private static String str(byte[] h, int off, int len) {
        int end = off;
        while (end < off + len && h[end] != 0) end++;
        return new String(h, off, end - off, StandardCharsets.UTF_8);
    }

    private static long oct(byte[] h, int off, int len) {
        String s = str(h, off, len).trim();
        return s.isEmpty() ? 0 : Long.parseLong(s, 8);
    }

    private static String sha256(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(f)) {
            byte[] b = new byte[64 * 1024];
            for (int n; (n = in.read(b)) > 0; ) md.update(b, 0, n);
        }
        StringBuilder sb = new StringBuilder();
        for (byte x : md.digest()) sb.append(String.format(Locale.ROOT, "%02x", x));
        return sb.toString();
    }

    /** Deletes a tree without following links (a link to /sdcard inside Linux must not take your files). */
    private static void delete(Path p) throws IOException {
        if (!Files.exists(p, java.nio.file.LinkOption.NOFOLLOW_LINKS)) return;
        Files.walkFileTree(p, new SimpleFileVisitor<Path>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes a) {
                dir.toFile().setWritable(true, true);
                dir.toFile().setExecutable(true, true);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes a) throws IOException {
                Files.deleteIfExists(file);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFileFailed(Path file, IOException e) throws IOException {
                Files.deleteIfExists(file);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult postVisitDirectory(Path dir, IOException e) throws IOException {
                Files.deleteIfExists(dir);
                return FileVisitResult.CONTINUE;
            }
        });
    }

    private static long sizeOf(Path p) {
        final long[] n = {0};
        try {
            Files.walkFileTree(p, new SimpleFileVisitor<Path>() {
                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes a) {
                    if (a.isRegularFile()) n[0] += a.size();
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult visitFileFailed(Path file, IOException e) {
                    return FileVisitResult.CONTINUE;
                }
            });
        } catch (IOException ignored) {
        }
        return n[0];
    }

    private static byte[] readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream o = new java.io.ByteArrayOutputStream();
        byte[] b = new byte[64 * 1024];
        for (int n; (n = in.read(b)) > 0; ) o.write(b, 0, n);
        return o.toByteArray();
    }

    private static String text(File f) {
        try (InputStream in = new FileInputStream(f)) {
            return new String(readAll(in), StandardCharsets.UTF_8);
        } catch (IOException e) {
            return "";
        }
    }

    private static void text(File f, String s) throws IOException {
        f.getParentFile().mkdirs();
        if (Files.isSymbolicLink(f.toPath())) f.delete();
        try (OutputStream o = new FileOutputStream(f)) {
            o.write(s.getBytes(StandardCharsets.UTF_8));
        }
    }
}
