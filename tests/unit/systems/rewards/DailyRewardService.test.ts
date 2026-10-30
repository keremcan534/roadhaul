import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { EconomyService } from '../../../../src/systems/economy/EconomyService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { DailyRewardService } from '../../../../src/systems/rewards/DailyRewardService';
import { MemoryLogger } from '../../../support/MemoryLogger';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const CONFIG = { credits: [100, 200, 300], levelBonus: 0.5 };

/** A company at `level` with 1000 credits; the clock at noon UTC of day 20 000, the player in UTC+3. */
function setup(level = 1) {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const economy = new EconomyService(events, DEFAULT_GAME_CONFIG.economy, logger);
  economy.restore(1000);
  const company = { level };
  let nowMs = 20_000 * DAY_MS + 12 * HOUR_MS;
  const clock = { now: () => nowMs };
  const daily = new DailyRewardService(CONFIG, economy, company, clock, 180, events, logger);
  const claimed: GameEvents['DailyRewardClaimed'][] = [];
  events.on('DailyRewardClaimed', (event) => claimed.push(event));
  const later = (hours: number): void => {
    nowMs += hours * HOUR_MS;
  };
  return { daily, economy, company, claimed, later };
}

describe('DailyRewardService', () => {
  it('pays day 1 once a day, telling the game, and saves the streak', () => {
    const { daily, economy, claimed } = setup();

    expect(daily.offer).toEqual({ claimable: true, day: 1, streak: 1, credits: [100, 200, 300] });
    expect(daily.claim()).toEqual({ ok: true, value: 100 });
    expect(economy.credits).toBe(1100);
    expect(claimed).toEqual([{ day: 1, streak: 1, credits: 100 }]);
    expect(daily.offer.claimable).toBe(false);
    expect(daily.claim()).toEqual({ ok: false, error: 'claimed' });
    expect(economy.credits).toBe(1100);
    expect(daily.snapshot()).toEqual({ lastClaimDay: 20_000, streak: 1 });
  });

  it('pays more each day in a row, from the player’s own midnight, and starts again after a day missed', () => {
    const { daily, economy, later } = setup();
    daily.claim();
    // 20:59 UTC is 23:59 in UTC+3: still the same day there.
    later(8 + 59 / 60);
    expect(daily.offer.claimable).toBe(false);
    later(1 / 60);
    expect(daily.claim()).toEqual({ ok: true, value: 200 });
    later(24);
    expect(daily.claim()).toEqual({ ok: true, value: 300 });
    later(24);
    expect(daily.offer).toMatchObject({ claimable: true, day: 1, streak: 4 });
    later(24);
    expect(daily.offer).toMatchObject({ claimable: true, day: 1, streak: 1 });
    expect(economy.credits).toBe(1000 + 100 + 200 + 300);
  });

  it('pays a company more at a higher level', () => {
    const { daily, company } = setup(3);
    expect(daily.offer.credits).toEqual([200, 400, 600]);
    company.level = 5;
    expect(daily.claim()).toEqual({ ok: true, value: 300 });
  });

  it('takes up a saved streak', () => {
    const { daily } = setup();
    daily.restore({ lastClaimDay: 19_999, streak: 2 });
    expect(daily.offer).toMatchObject({ claimable: true, day: 3, streak: 3 });
    daily.restore({ lastClaimDay: 20_000, streak: 2 });
    expect(daily.offer.claimable).toBe(false);
  });
});
