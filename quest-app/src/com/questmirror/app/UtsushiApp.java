package com.questmirror.app;

import android.app.Application;

/** Whatever starts this app's process (the home screen, the agent, the control service), the space
 *  without the PC starts with it, so an open space tab in the browser always finds its server. */
public class UtsushiApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        new Thread(() -> SpaceServer.start(this), "space-server").start();
    }
}
