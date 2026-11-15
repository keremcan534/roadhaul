import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { NO_PERKS, type FacilityPerks } from '../../../../src/domain/company/facilities';
import { RentService } from '../../../../src/systems/company/RentService';
import { EconomyService } from '../../../../src/systems/economy/EconomyService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { MemoryLogger } from '../../../support/MemoryLogger';

const HOUR_MS = 3_600_000;

/** Rent at a warehouse whose rate the test sets, on a clock the test moves. */
function setup() {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const economy = new EconomyService(events, DEFAULT_GAME_CONFIG.economy, logger);
  economy.restore(0);
  const clock = { nowMs: 1_000_000 };
  const perks: { perks: FacilityPerks } = { perks: NO_PERKS };
  const rent = new RentService(perks, economy, { now: () => clock.nowMs }, 8, events, logger);
  rent.restore({ storedCredits: 0, sinceMs: clock.nowMs });
  const collected: number[] = [];
  events.on('RentCollected', ({ credits }) => collected.push(credits));
  /** The warehouse built to `ratePerHour`, as FacilityService does it: the perks first, then the event. */
  const build = (ratePerHour: number): void => {
    perks.perks = { ...NO_PERKS, rentPerHour: ratePerHour };
    events.emit('FacilityBuilt', { facilityId: 'warehouse', level: 1, cost: 6000 });
  };
  return { rent, economy, clock, build, collected };
}

describe('RentService', () => {
  it('brings nothing without a warehouse', () => {
    const { rent, clock } = setup();
    clock.nowMs += 10 * HOUR_MS;
    expect(rent.ratePerHour).toBe(0);
    expect(rent.waiting).toBe(0);
    expect(rent.collect()).toEqual({ ok: false, error: 'nothingToCollect' });
  });

  it('piles rent up from the warehouse built, up to its cap, and pays it in when collected', () => {
    const { rent, economy, clock, build, collected } = setup();
    clock.nowMs += 5 * HOUR_MS; // Before the warehouse: nothing for this time.
    build(150);
    clock.nowMs += 2 * HOUR_MS + 6 * 60_000;
    expect(rent.waiting).toBe(315);
    expect(rent.capacity).toBe(1200);
    expect(rent.fullness).toBeCloseTo(315 / 1200, 6);

    expect(rent.collect()).toEqual({ ok: true, value: 315 });
    expect(economy.credits).toBe(315);
    expect(collected).toEqual([315]);
    expect(rent.waiting).toBe(0);

    clock.nowMs += 50 * HOUR_MS;
    expect(rent.waiting).toBe(1200);
  });

  it('settles at the old rate when a level is built, then grows at the new one', () => {
    const { rent, clock, build } = setup();
    build(150);
    clock.nowMs += 2 * HOUR_MS;
    build(350);
    clock.nowMs += HOUR_MS;
    expect(rent.waiting).toBe(300 + 350);
  });

  it('goes on growing while the game is closed: the save keeps what waits and since when', () => {
    const first = setup();
    first.build(150);
    first.clock.nowMs += HOUR_MS;
    const saved = first.rent.snapshot();

    const second = setup();
    second.build(150);
    second.rent.restore(saved);
    second.clock.nowMs = first.clock.nowMs + 3 * HOUR_MS;
    expect(second.rent.waiting).toBe(600);
  });
});
