package com.questmirror.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.ThumbnailUtils;
import android.os.Environment;
import android.provider.MediaStore;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Files in the space when there is no PC: the Quest's own storage, answered the same way the PC
 * host answers (/api/files/...), so the Files window works unchanged. Needs "All files access"
 * (the app asks once); without it, only the app's own folder is reachable.
 */
final class QuestFiles {
    private QuestFiles() {
    }

    static boolean allowed() {
        return Environment.isExternalStorageManager();
    }

    static JSONObject roots() throws Exception {
        JSONArray quest = new JSONArray();
        String[][] places = {
                {"Storage", "/sdcard", "home"}, {"Download", "/sdcard/Download", "down"}, {"Screenshots", "/sdcard/Oculus/Screenshots", "pic"},
                {"Videos", "/sdcard/Oculus/VideoShots", "vid"}, {"Pictures", "/sdcard/Pictures", "pic"}, {"Movies", "/sdcard/Movies", "vid"},
                {"Music", "/sdcard/Music", "music"}, {"Documents", "/sdcard/Documents", "doc"}};
        for (String[] p : places) quest.put(new JSONObject().put("name", p[0]).put("path", p[1]).put("icon", p[2]));
        return new JSONObject().put("pc", new JSONArray()).put("quest", quest).put("questOnline", true).put("allowed", allowed());
    }

    private static File file(String path) {
        if (path == null || path.isEmpty() || path.contains("\u0000")) throw new IllegalArgumentException("No path");
        return new File(path);
    }

    private static void need() {
        if (!allowed()) throw new SecurityException("Allow UTSUSHI to reach your files: open the UTSUSHI app and turn on “All files access”.");
    }

    static JSONObject list(String path) throws Exception {
        need();
        File dir = file(path == null || path.isEmpty() ? "/sdcard" : path);
        File[] fs = dir.listFiles();
        if (fs == null) throw new IllegalStateException("Cannot open " + dir.getPath());
        JSONArray entries = new JSONArray();
        for (File f : fs) {
            entries.put(new JSONObject().put("name", f.getName()).put("dir", f.isDirectory()).put("size", f.isDirectory() ? 0 : f.length()).put("mtime", f.lastModified()));
        }
        String parent = dir.getParent();
        return new JSONObject().put("src", "quest").put("path", dir.getPath()).put("parent", dir.getPath().equals("/") ? JSONObject.NULL : parent).put("entries", entries);
    }

    static JSONObject search(String path, String q) throws Exception {
        need();
        List<File> out = new ArrayList<>();
        String low = q == null ? "" : q.toLowerCase(Locale.ROOT);
        if (!low.isEmpty()) walk(file(path), low, out, 0);
        JSONArray entries = new JSONArray();
        for (File f : out) entries.put(new JSONObject().put("name", f.getName()).put("full", f.getPath()).put("dir", f.isDirectory()).put("size", 0).put("mtime", 0));
        return new JSONObject().put("entries", entries);
    }

    private static void walk(File dir, String low, List<File> out, int depth) {
        File[] fs = dir.listFiles();
        if (fs == null || depth > 8) return;
        for (File f : fs) {
            if (out.size() >= 200) return;
            if (f.getName().toLowerCase(Locale.ROOT).contains(low)) out.add(f);
            if (f.isDirectory() && !f.getName().startsWith(".")) walk(f, low, out, depth + 1);
        }
    }

    static File raw(String path) {
        need();
        File f = file(path);
        if (!f.isFile()) throw new IllegalArgumentException("Not a file");
        return f;
    }

    static byte[] thumb(String path) throws Exception {
        need();
        File f = file(path);
        String n = f.getName().toLowerCase(Locale.ROOT);
        Bitmap b;
        if (n.matches(".*\\.(mp4|webm|mov|m4v|mkv)$")) b = ThumbnailUtils.createVideoThumbnail(f.getPath(), MediaStore.Images.Thumbnails.MINI_KIND);
        else {
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(f.getPath(), o);
            int s = 1;
            while (Math.max(o.outWidth, o.outHeight) / (s * 2) >= 320) s *= 2;
            o = new BitmapFactory.Options();
            o.inSampleSize = s;
            b = BitmapFactory.decodeFile(f.getPath(), o);
        }
        if (b == null) throw new IllegalStateException("No preview");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.JPEG, 80, out);
        return out.toByteArray();
    }

    static void mkdir(String dir, String name) {
        need();
        if (!new File(file(dir), clean(name)).mkdirs()) throw new IllegalStateException("Could not create the folder");
    }

    static void rename(String path, String name) {
        need();
        File f = file(path);
        if (!f.renameTo(new File(f.getParentFile(), clean(name)))) throw new IllegalStateException("Could not rename");
    }

    static void delete(JSONArray paths) {
        need();
        for (int i = 0; i < paths.length(); i++) rm(file(paths.optString(i)));
    }

    private static void rm(File f) {
        File[] kids = f.isDirectory() ? f.listFiles() : null;
        if (kids != null) for (File k : kids) rm(k);
        if (!f.delete() && f.exists()) throw new IllegalStateException("Could not delete " + f.getName());
    }

    static void copy(JSONArray paths, String destDir, boolean move) throws Exception {
        need();
        File dest = file(destDir);
        for (int i = 0; i < paths.length(); i++) {
            File f = file(paths.optString(i));
            File to = new File(dest, f.getName());
            if (move && f.renameTo(to)) continue;
            cp(f, to);
            if (move) rm(f);
        }
    }

    private static void cp(File from, File to) throws Exception {
        if (from.isDirectory()) {
            to.mkdirs();
            File[] kids = from.listFiles();
            if (kids != null) for (File k : kids) cp(k, new File(to, k.getName()));
            return;
        }
        try (InputStream in = new FileInputStream(from); OutputStream out = new FileOutputStream(to)) {
            byte[] b = new byte[65536];
            int n;
            while ((n = in.read(b)) > 0) out.write(b, 0, n);
        }
    }

    private static String clean(String name) {
        String n = name == null ? "" : name.trim();
        if (n.isEmpty() || n.contains("/") || n.equals("..") || n.equals(".")) throw new IllegalArgumentException("Not a usable name");
        return n;
    }
}
