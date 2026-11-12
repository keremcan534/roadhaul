import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../../../src/core/storage/KeyValueStorage';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import type { DailyStreak } from '../../../../src/domain/rewards/dailyReward';
import {
  ReminderService,
  type LocalNotice,
  type LocalNotifier,
  type NoticePermission,
  type ReminderText,
} from '../../../../src/systems/reminders/ReminderService';
import { MemoryLogger } from '../../../support/MemoryLogger';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Two in the afternoon of day 20 000, in UTC. */
const NOW = 20_000 * DAY_MS + 14 * HOUR_MS;

/** The phone's notifications: what it was asked to show, and what it answers about permission. */
class FakeNotifier implements LocalNotifier {
  scheduled: LocalNotice[] = [];
  requests = 0;
  failing = false;
  constructor(public allowed: NoticePermission, private readonly answer: NoticePermission = 'granted') {}
  permission(): Promise<NoticePermission> {
    return Promise.resolve(this.allowed);
  }
  requestPermission(): Promise<NoticePermission> {
    this.requests++;
    if (this.allowed === 'prompt') {
      this.allowed = this.answer;
    }
    return Promise.resolve(this.allowed);
  }
  schedule(notices: readonly LocalNotice[]): Promise<void> {
    if (this.failing) {
      return Promise.reject(new Error('no alarms'));
    }
    this.scheduled.push(...notices);
    return Promise.resolve();
  }
  cancelAll(): Promise<void> {
    this.scheduled = [];
    return Promise.resolve();
  }
}

const TEXT: ReminderText = (reminder) =>
  reminder.kind === 'dailyReward'
    ? { title: `Day ${reminder.streakDay}`, body: 'Your daily reward is ready.' }
    : { title: 'Free crate', body: 'Your free crate is ready.' };

function setup(storage = new MemoryStorage(), streak: DailyStreak = { lastClaimDay: 20_000, streak: 2 }) {
  const logger = new MemoryLogger();
  const reminders = new ReminderService(
    DEFAULT_GAME_CONFIG.reminders,
    { snapshot: () => streak },
    7,
    { freeCrate: { readyAtMs: NOW } },
    { now: () => NOW },
    0,
    storage,
    logger,
  );
  return { reminders, storage, logger };
}

describe('ReminderService', () => {
  it('offers nothing in a browser, where there are no notifications', async () => {
    const { reminders } = setup();
    expect(reminders.available).toBe(false);
    expect(reminders.askDue).toBe(false);
    expect(await reminders.ask()).toBe(false);
    await expect(reminders.away()).resolves.toBeUndefined();
  });

  it('leaves nothing with the phone until the player says yes, even where the phone would allow it', async () => {
    const { reminders } = setup();
    const phone = new FakeNotifier('granted');
    await reminders.attach(phone, TEXT);
    await reminders.away();
    expect(phone.scheduled).toEqual([]);
    expect(reminders.on).toBe(false);
    expect(reminders.askDue).toBe(true);
  });

  it('asks the phone on "Remind me", then plans the reminders as the player leaves and takes them back on return', async () => {
    const { reminders } = setup();
    const phone = new FakeNotifier('prompt');
    await reminders.attach(phone, TEXT);
    expect(await reminders.ask()).toBe(true);
    expect(phone.requests).toBe(1);
    expect(reminders.askDue).toBe(false);

    await reminders.away();
    expect(phone.scheduled).toEqual([
      { id: 1, atMs: NOW + DAY_MS, title: 'Day 3', body: 'Your daily reward is ready.' },
      { id: 2, atMs: NOW + 3 * DAY_MS, title: 'Day 1', body: 'Your daily reward is ready.' },
    ]);
    // Left twice (the app's pause and the page hidden): the same reminders, not twice as many.
    await reminders.away();
    expect(phone.scheduled).toHaveLength(2);
    await reminders.back();
    expect(phone.scheduled).toEqual([]);
  });

  it('remembers the answer on the phone, and stops offering once the phone refused', async () => {
    const storage = new MemoryStorage();
    const first = setup(storage).reminders;
    const phone = new FakeNotifier('prompt', 'denied');
    await first.attach(phone, TEXT);
    expect(await first.ask()).toBe(false);
    await first.away();
    expect(phone.scheduled).toEqual([]);

    const again = setup(storage).reminders;
    await again.attach(phone, TEXT);
    expect(again.on).toBe(true);
    expect(again.askDue).toBe(false);
  });

  it('switches off in Settings, taking back what waits, and on again', async () => {
    const { reminders } = setup();
    const phone = new FakeNotifier('granted');
    await reminders.attach(phone, TEXT);
    await reminders.setOn(true);
    await reminders.away();
    expect(phone.scheduled).toHaveLength(2);
    expect(await reminders.setOn(false)).toBe(false);
    expect(phone.scheduled).toEqual([]);
    await reminders.away();
    expect(phone.scheduled).toEqual([]);
    expect(await reminders.setOn(true)).toBe(true);
    expect(phone.requests).toBe(0);
  });

  it('reads the phone’s answer again on return: notifications allowed in Android’s settings meanwhile count', async () => {
    const { reminders } = setup();
    const phone = new FakeNotifier('prompt', 'denied');
    await reminders.attach(phone, TEXT);
    await reminders.ask();
    phone.allowed = 'granted';
    await reminders.back();
    await reminders.away();
    expect(phone.scheduled).toHaveLength(2);
  });

  it('logs a phone that fails, and goes on', async () => {
    const { reminders, logger } = setup();
    const phone = new FakeNotifier('granted');
    await reminders.attach(phone, TEXT);
    await reminders.setOn(true);
    phone.failing = true;
    await expect(reminders.away()).resolves.toBeUndefined();
    expect(logger.messages('warn')).toContain('The reminders could not be set.');
    phone.failing = false;
    await reminders.away();
    expect(phone.scheduled).toHaveLength(2);
  });
});
