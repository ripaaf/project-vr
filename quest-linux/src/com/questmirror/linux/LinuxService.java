package com.questmirror.linux;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

/**
 * Started by UTSUSHI (only apps signed like it may: see the manifest). It answers UTSUSHI on
 * 127.0.0.1:8771, and only when the request carries the token UTSUSHI gave it when starting it,
 * so a web page in the browser can't use it.
 */
public class LinuxService extends Service {
    private static final String CHANNEL = "linux";
    static volatile String token;

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "UTSUSHI Linux", NotificationManager.IMPORTANCE_LOW));
        Notification n = new Notification.Builder(this, CHANNEL)
                .setContentTitle("UTSUSHI Linux")
                .setContentText("Linux for the Terminal in the space.")
                .setSmallIcon(R.drawable.ic_linux)
                .setOngoing(true)
                .build();
        startForeground(1, n);
        Linux.init(this);
        Http.start();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String t = intent == null ? null : intent.getStringExtra("token");
        if (t != null && t.length() >= 16) token = t;
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
