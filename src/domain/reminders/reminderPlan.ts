import type { GameConfig } from '../../data/config/GameConfig';
import { dailyOffer, localDay, type DailyStreak } from '../rewards/dailyReward';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** When and how often the phone reminds the player of the game. */
export type ReminderRules = GameConfig['reminders'];

/** A reminder the phone shows while the game is away. */
export type Reminder =
  /** The daily reward waits: `streakDay` is the streak's day it would be that day (1 when the streak starts over). */
  | { readonly kind: 'dailyReward'; readonly atMs: number; readonly streakDay: number }
  /** The free crate (CrateService) is ready. */
  | { readonly kind: 'freeCrate'; readonly atMs: number };

/** What the game stands at as the player leaves it. */
export interface ReminderSituation {
  readonly nowMs: number;
  /** The player's time zone: minutes ahead of UTC. */
  readonly offsetMinutes: number;
  /** The daily reward's streak as saved, and how many days its round has. */
  readonly streak: DailyStreak;
  readonly streakDays: number;
  /** When the next free crate is ready (Unix ms); at or before now when it already is. */
  readonly freeCrateAtMs: number;
}

/**
 * The reminders to leave with the phone as the player leaves the game: the daily reward on each of the rules' days
 * after this one (`dailyRewardDays`), at the hour the player left, kept between `earliestHour` and `latestHour` of
 * their own day; and the free crate the same day, when it comes ready a while after they left (`freeCrateMinHours`)
 * and before `latestHour`. Never more than one a day: the earliest that day's. In time order.
 */
export function planReminders(situation: ReminderSituation, rules: ReminderRules): readonly Reminder[] {
  const { nowMs, offsetMinutes } = situation;
  const offsetMs = offsetMinutes * MINUTE_MS;
  const today = localDay(nowMs, offsetMinutes);
  const startOf = (day: number): number => day * DAY_MS - offsetMs;
  const earliestMs = rules.earliestHour * HOUR_MS;
  const latestMs = rules.latestHour * HOUR_MS;
  const leftAtMs = nowMs - startOf(today);
  const hourMs = Math.min(Math.max(leftAtMs, earliestMs), latestMs);

  const planned: Reminder[] = [];
  const crateAtMs = Math.max(situation.freeCrateAtMs, startOf(today) + earliestMs);
  if (situation.freeCrateAtMs >= nowMs + rules.freeCrateMinHours * HOUR_MS && crateAtMs <= startOf(today) + latestMs) {
    planned.push({ kind: 'freeCrate', atMs: crateAtMs });
  }
  for (const after of rules.dailyRewardDays) {
    const day = today + after;
    planned.push({
      kind: 'dailyReward',
      atMs: startOf(day) + hourMs,
      streakDay: dailyOffer(situation.streak, day, situation.streakDays).day,
    });
  }
  planned.sort((a, b) => a.atMs - b.atMs);
  return planned.filter(
    (reminder, index) => index === 0 || localDay(reminder.atMs, offsetMinutes) !== localDay(planned[index - 1]!.atMs, offsetMinutes),
  );
}

/** What the phone remembers of the player's reminders (not in the save: it is about this phone). */
export interface ReminderPrefs {
  /** The player asked for them ("Remind me", or Settings): off until then. They come only once the phone allows them too. */
  readonly on: boolean;
  /** The game asked once whether to remind the player (the daily reward's "Remind me"), whatever the answer. */
  readonly asked: boolean;
}

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = Object.freeze({ on: false, asked: false });

/** Prefs read back from storage; the defaults for what is missing or does not read. */
export function parseReminderPrefs(raw: unknown): ReminderPrefs {
  if (typeof raw !== 'object' || raw === null) {
    return DEFAULT_REMINDER_PREFS;
  }
  const { on, asked } = raw as Record<string, unknown>;
  return {
    on: typeof on === 'boolean' ? on : DEFAULT_REMINDER_PREFS.on,
    asked: typeof asked === 'boolean' ? asked : DEFAULT_REMINDER_PREFS.asked,
  };
}
