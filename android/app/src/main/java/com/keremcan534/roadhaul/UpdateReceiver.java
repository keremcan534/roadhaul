package com.keremcan534.roadhaul;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

/**
 * Android's word that the game was just updated (Google Play): the notice the
 * game left (UpdateNoticePlugin) is shown, if it is armed and the phone still
 * lets the game notify. A tap opens the game, where What's New tells the rest.
 * Nothing comes from a server: only players who turned the reminders on see
 * it, and only after an update.
 */
public class UpdateReceiver extends BroadcastReceiver {

    /** Apart from the reminders' ids (1, 2, …). */
    private static final int NOTICE_ID = 7001;
    private static final int ACCENT = 0xFFF2A33A;

    @SuppressLint("MissingPermission")
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
            return;
        }
        SharedPreferences preferences = context.getSharedPreferences(UpdateNoticePlugin.PREFERENCES, Context.MODE_PRIVATE);
        String title = preferences.getString(UpdateNoticePlugin.TITLE, null);
        String body = preferences.getString(UpdateNoticePlugin.BODY, null);
        String channelId = preferences.getString(UpdateNoticePlugin.CHANNEL_ID, null);
        String channelName = preferences.getString(UpdateNoticePlugin.CHANNEL_NAME, null);
        if (!preferences.getBoolean(UpdateNoticePlugin.ARMED, false) || title == null || body == null || channelId == null || channelName == null) {
            return;
        }
        NotificationManagerCompat notifications = NotificationManagerCompat.from(context);
        if (!notifications.areNotificationsEnabled()) {
            return;
        }
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // The reminders' channel, made by the game at its start; made here too in case it is not there yet.
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager != null && manager.getNotificationChannel(channelId) == null) {
                manager.createNotificationChannel(new NotificationChannel(channelId, channelName, NotificationManager.IMPORTANCE_DEFAULT));
            }
        }
        Intent open = new Intent(context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder notice = new NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_stat_roadhaul)
            .setColor(ACCENT)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        try {
            notifications.notify(NOTICE_ID, notice.build());
        } catch (SecurityException refused) {
            // The permission went between the check and the notice: nothing to show.
        }
    }
}
