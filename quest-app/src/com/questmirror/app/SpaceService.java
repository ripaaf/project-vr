package com.questmirror.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

/** Keeps the app alive while you are in the space without the PC (the browser is in front, so
 *  Android would otherwise end this app and the space would lose its server). */
public class SpaceService extends Service {
    private static final String CHANNEL = "space";

    @Override
    public void onCreate() {
        super.onCreate();
        SpaceServer.start(this);
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "UTSUSHI Space", NotificationManager.IMPORTANCE_LOW));
        Notification n = new Notification.Builder(this, CHANNEL)
                .setContentTitle("UTSUSHI Space")
                .setContentText("The space runs on this Quest, ready without the PC.")
                .setSmallIcon(R.drawable.ic_launcher)
                .setOngoing(true)
                .build();
        startForeground(1, n);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
