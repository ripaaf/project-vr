package com.questmirror.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.SecureRandom;
import java.util.Locale;

/**
 * Linux in the Terminal (Alpine, so `apk add` works) lives in a small companion app, UTSUSHI Linux:
 * Android lets only apps made for Android 9 run programs they download. This app starts it (only
 * apps signed like UTSUSHI may), hands it a secret, and passes the space's requests through.
 */
final class LinuxBridge {
    static final String PKG = "com.questmirror.linux";
    private static final String TOKEN;

    static {
        byte[] b = new byte[24];
        new SecureRandom().nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format(Locale.ROOT, "%02x", x));
        TOKEN = sb.toString();
    }

    private LinuxBridge() {
    }

    static boolean installed(Context c) {
        try {
            c.getPackageManager().getPackageInfo(PKG, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    /** Starts the companion (or reminds it of the secret). */
    static void wake(Context c) {
        if (!installed(c)) return;
        try {
            c.startForegroundService(new Intent().setComponent(new ComponentName(PKG, PKG + ".LinuxService")).putExtra("token", TOKEN));
        } catch (Exception ignored) {
        }
    }

    /** `sub` is the companion's path (/state, /shell/read?…); answers with its JSON. */
    static AgentServer.Response forward(Context c, String method, String sub, byte[] body) {
        if (!installed(c)) return AgentServer.Response.error(503, "Linux needs UTSUSHI Linux on the headset (quest-linux, installed next to UTSUSHI).");
        Exception last = null;
        for (int attempt = 0; attempt < 3; attempt++) {
            try {
                HttpURLConnection h = (HttpURLConnection) new URL("http://127.0.0.1:8771" + sub).openConnection();
                h.setConnectTimeout(1500);
                h.setReadTimeout(20000);
                h.setRequestMethod(method);
                h.setRequestProperty("X-Token", TOKEN);
                if (method.equals("POST")) {
                    h.setDoOutput(true);
                    h.setRequestProperty("Content-Type", "application/json");
                    try (OutputStream o = h.getOutputStream()) {
                        o.write(body);
                    }
                }
                int code = h.getResponseCode();
                if (code == 401) {
                    // it restarted and forgot the secret
                    h.disconnect();
                    wake(c);
                    Thread.sleep(700);
                    continue;
                }
                InputStream in = code >= 400 ? h.getErrorStream() : h.getInputStream();
                ByteArrayOutputStream b = new ByteArrayOutputStream();
                if (in != null) {
                    byte[] buf = new byte[16384];
                    for (int n; (n = in.read(buf)) > 0; ) b.write(buf, 0, n);
                    in.close();
                }
                h.disconnect();
                return new AgentServer.Response(code, "application/json", b.toByteArray());
            } catch (java.net.ConnectException e) {
                // not running yet: start it and give it a moment
                last = e;
                wake(c);
                try {
                    Thread.sleep(1200);
                } catch (InterruptedException ignored) {
                }
            } catch (Exception e) {
                last = e;
                break;
            }
        }
        return AgentServer.Response.error(503, "UTSUSHI Linux did not answer" + (last != null && last.getMessage() != null ? ": " + last.getMessage() : "."));
    }
}
