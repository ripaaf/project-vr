package com.questmirror.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Lets the PC start the agent (apps, icons, volume, panels) without opening the app on the headset:
 * `am broadcast -n com.questmirror.app/.AgentStarter`. Guarded by DUMP, which only the shell
 * (adb) and the system hold — other apps can't trigger it.
 */
public class AgentStarter extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Agent.ensureStarted(context);
    }
}
