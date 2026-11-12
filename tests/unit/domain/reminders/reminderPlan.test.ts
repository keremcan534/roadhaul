import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import {
  DEFAULT_REMINDER_PREFS,
  parseReminderPrefs,
  planReminders,
  type ReminderSituation,
} from '../../../../src/domain/reminders/reminderPlan';
import { NO_STREAK } from '../../../../src/domain/rewards/dailyReward';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const RULES = DEFAULT_GAME_CONFIG.reminders;
/** Day 20 000 of the player's calendar, in UTC+3. */
const TODAY = 20_000;
const OFFSET = 180;
/** `hours` past the player's midnight, `days` after today. */
const local = (hours: number, days = 0): number => (TODAY + days) * DAY_MS + (hours - 3) * HOUR_MS;

function leaving(hours: number, extra: Partial<ReminderSituation> = {}): ReminderSituation {
  const nowMs = local(hours);
  return { nowMs, offsetMinutes: OFFSET, streak: NO_STREAK, streakDays: 7, freeCrateAtMs: nowMs, ...extra };
}

describe('planReminders', () => {
  it('reminds of the daily reward tomorrow and two days on, at the hour the player left', () => {
    expect(planReminders(leaving(19.5), RULES)).toEqual([
      { kind: 'dailyReward', atMs: local(19.5, 1), streakDay: 1 },
      { kind: 'dailyReward', atMs: local(19.5, 3), streakDay: 1 },
    ]);
  });

  it('keeps them between ten in the morning and nine at night, the player’s own', () => {
    expect(planReminders(leaving(7), RULES).map((reminder) => reminder.atMs)).toEqual([local(10, 1), local(10, 3)]);
    expect(planReminders(leaving(23.75), RULES).map((reminder) => reminder.atMs)).toEqual([local(21, 1), local(21, 3)]);
  });

  it('names the streak’s day: the next one tomorrow after today’s claim, day 1 again once a day is missed', () => {
    const claimedToday = leaving(12, { streak: { lastClaimDay: TODAY, streak: 4 } });
    expect(planReminders(claimedToday, RULES).map((reminder) => reminder.kind === 'dailyReward' && reminder.streakDay)).toEqual([5, 1]);
    const claimedYesterday = leaving(12, { streak: { lastClaimDay: TODAY - 1, streak: 4 } });
    expect(planReminders(claimedYesterday, RULES).map((reminder) => reminder.kind === 'dailyReward' && reminder.streakDay)).toEqual([1, 1]);
  });

  it('reminds of the free crate the same day when it comes ready a while later, before the evening ends', () => {
    expect(planReminders(leaving(11, { freeCrateAtMs: local(16) }), RULES)[0]).toEqual({ kind: 'freeCrate', atMs: local(16) });
    // Ready in under two hours, or after nine at night: not worth a reminder of its own.
    expect(planReminders(leaving(11, { freeCrateAtMs: local(12.5) }), RULES)[0]!.kind).toBe('dailyReward');
    expect(planReminders(leaving(17, { freeCrateAtMs: local(22) }), RULES)[0]!.kind).toBe('dailyReward');
  });

  it('holds a crate ready in the night until ten in the morning, if that is still the same day', () => {
    expect(planReminders(leaving(1, { freeCrateAtMs: local(6) }), RULES)[0]).toEqual({ kind: 'freeCrate', atMs: local(10) });
  });

  it('never reminds twice in a day: the earliest that day’s', () => {
    const rules = { ...RULES, dailyRewardDays: [1, 2, 3] };
    const planned = planReminders(leaving(12), rules);
    expect(planned).toHaveLength(3);
    const days = planned.map((reminder) => Math.floor((reminder.atMs + OFFSET * 60_000) / DAY_MS));
    expect(new Set(days).size).toBe(3);
    expect(planReminders(leaving(12), { ...RULES, dailyRewardDays: [] })).toEqual([]);
  });
});

describe('parseReminderPrefs', () => {
  it('reads what was kept, and the defaults (off, not yet asked) for anything else', () => {
    expect(parseReminderPrefs({ on: true, asked: true })).toEqual({ on: true, asked: true });
    expect(parseReminderPrefs({ on: 'yes' })).toEqual(DEFAULT_REMINDER_PREFS);
    expect(parseReminderPrefs(null)).toEqual({ on: false, asked: false });
  });
});
