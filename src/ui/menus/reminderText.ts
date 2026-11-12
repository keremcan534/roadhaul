import type { Reminder } from '../../domain/reminders/reminderPlan';
import type { Strings } from '../i18n';

/**
 * What a reminder says on the phone (ReminderService): the free crate; the daily reward, by the streak's day when a
 * streak goes on (day 2 and up), plainly when it starts over.
 */
export function reminderText(strings: Strings, reminder: Reminder): { readonly title: string; readonly body: string } {
  if (reminder.kind === 'freeCrate') {
    return { title: strings.t('reminder.crate.title'), body: strings.t('reminder.crate.body') };
  }
  if (reminder.streakDay > 1) {
    return { title: strings.t('reminder.streak.title', { day: reminder.streakDay }), body: strings.t('reminder.streak.body') };
  }
  return { title: strings.t('reminder.daily.title'), body: strings.t('reminder.daily.body') };
}
