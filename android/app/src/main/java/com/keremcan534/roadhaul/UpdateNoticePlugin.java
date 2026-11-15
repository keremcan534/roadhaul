package com.keremcan534.roadhaul;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The update notice's words, kept on the phone for UpdateReceiver: the game
 * cannot run when Google Play has just updated it, so it leaves them here
 * beforehand, in the player's language (ReminderService arms the notice while
 * the reminders are on and allowed, and takes it back otherwise). Nothing is
 * sent anywhere.
 */
@CapacitorPlugin(name = "UpdateNotice")
public class UpdateNoticePlugin extends Plugin {

    static final String PREFERENCES = "roadhaul_update_notice";
    static final String ARMED = "armed";
    static final String TITLE = "title";
    static final String BODY = "body";
    static final String CHANNEL_ID = "channelId";
    static final String CHANNEL_NAME = "channelName";

    @PluginMethod
    public void arm(PluginCall call) {
        String title = call.getString(TITLE);
        String body = call.getString(BODY);
        String channelId = call.getString(CHANNEL_ID);
        String channelName = call.getString(CHANNEL_NAME);
        if (title == null || body == null || channelId == null || channelName == null) {
            call.reject("The update notice needs a title, a body and a channel.");
            return;
        }
        preferences()
            .edit()
            .putBoolean(ARMED, true)
            .putString(TITLE, title)
            .putString(BODY, body)
            .putString(CHANNEL_ID, channelId)
            .putString(CHANNEL_NAME, channelName)
            .apply();
        call.resolve();
    }

    @PluginMethod
    public void disarm(PluginCall call) {
        preferences().edit().putBoolean(ARMED, false).apply();
        call.resolve();
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }
}
