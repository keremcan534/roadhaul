import { describe, expect, it } from 'vitest';
import { stringsFor } from '../../../../src/ui/i18n';
import { reminderText } from '../../../../src/ui/menus/reminderText';

describe('reminderText', () => {
  const strings = stringsFor('en');

  it('names the streak’s day while a streak goes on', () => {
    expect(reminderText(strings, { kind: 'dailyReward', atMs: 0, streakDay: 4 })).toEqual({
      title: 'Day 4 of your daily reward is ready',
      body: 'Collect it today to keep your streak going.',
    });
  });

  it('says it plainly when the streak starts over, and names the free crate', () => {
    expect(reminderText(strings, { kind: 'dailyReward', atMs: 0, streakDay: 1 }).title).toBe('Your daily reward is ready');
    expect(reminderText(strings, { kind: 'freeCrate', atMs: 0 }).title).toBe('Your free crate is ready');
    expect(reminderText(stringsFor('tr'), { kind: 'dailyReward', atMs: 0, streakDay: 3 }).title).toBe('Günlük ödülünün 3. günü hazır');
  });
});
