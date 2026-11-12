import type { PermissionState } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { LocalNotice, LocalNotifier, NoticePermission } from '../../systems/reminders/ReminderService';

/** The reminders' channel: what Android's settings show for them, the player's to turn off there too. */
const CHANNEL_ID = 'reminders';

/**
 * The phone's own notifications in the Android app (@capacitor/local-notifications), for ReminderService: left with
 * Android's alarm service, shown at their time with the game closed, nothing sent anywhere. Inexact alarms: the app
 * asks for no exact-alarm permission, and a reminder may come a few minutes late. The entry point loads this module only
 * in the Android app. `channelName` names the channel in the player's language.
 */
export async function localNotifications(channelName: string): Promise<LocalNotifier> {
  await LocalNotifications.createChannel({ id: CHANNEL_ID, name: channelName, importance: 3, visibility: 1 });
  return {
    permission: async () => permissionOf((await LocalNotifications.checkPermissions()).display),
    requestPermission: async () => permissionOf((await LocalNotifications.requestPermissions()).display),
    schedule: async (notices: readonly LocalNotice[]) => {
      if (notices.length === 0) {
        return;
      }
      await LocalNotifications.schedule({
        notifications: notices.map((notice) => ({
          id: notice.id,
          title: notice.title,
          body: notice.body,
          schedule: { at: new Date(notice.atMs), allowWhileIdle: true },
          channelId: CHANNEL_ID,
          smallIcon: 'ic_stat_roadhaul',
          iconColor: '#F2A33A',
          autoCancel: true,
          isExactNotification: false,
        })),
      });
    },
    cancelAll: () => LocalNotifications.cancelAll(),
  };
}

function permissionOf(state: PermissionState): NoticePermission {
  return state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'prompt';
}
