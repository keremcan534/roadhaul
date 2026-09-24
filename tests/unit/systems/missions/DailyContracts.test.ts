import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { GAME_CONTENT } from '../../../../src/data/content';
import { DrivingService } from '../../../../src/systems/driving/DrivingService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { DailyContracts } from '../../../../src/systems/missions/DailyContracts';
import { MemoryLogger } from '../../../support/MemoryLogger';

const HOUR_MS = 60 * 60 * 1000;
/** 2026-09-24, 07:30 UTC: the second six-hour batch of the day. */
const MORNING_MS = Date.UTC(2026, 8, 24, 7, 30);

function setup(config = { count: 5, refreshHours: 6 }) {
  const logger = new MemoryLogger();
  const content = ContentCatalog.create(GAME_CONTENT);
  const driving = new DrivingService(content, new EventBus<GameEvents>(logger), logger);
  const clock = { nowMs: MORNING_MS, now: () => clock.nowMs };
  const daily = new DailyContracts(content, driving, clock, config);
  return { content, driving, clock, daily };
}

describe('DailyContracts', () => {
  it('deals nothing until a truck is on a map', () => {
    const { daily } = setup();

    expect(daily.current()).toEqual([]);
  });

  it('deals a batch for the map, numbered by the clock, and keeps it until the next', () => {
    const { driving, clock, daily } = setup();
    driving.start(DEFAULT_GAME_CONFIG.newGame.startingVehicleId, DEFAULT_GAME_CONFIG.newGame.startingMapId);
    const batch = Math.floor(MORNING_MS / (6 * HOUR_MS));

    const first = daily.current();
    expect(first.map((contract) => contract.id)).toEqual([1, 2, 3, 4, 5].map((slot) => `daily_${batch}_${slot}`));
    for (const contract of first) {
      expect(driving.world.depotOf(contract.originCityId)).toBeDefined();
      expect(driving.world.depotOf(contract.destinationCityId)).toBeDefined();
    }

    clock.nowMs += 4 * HOUR_MS; // 11:30: the same batch, the very same list.
    expect(daily.current()).toBe(first);
    expect(daily.msUntilNextBatch()).toBe(30 * 60 * 1000);

    clock.nowMs += HOUR_MS; // 12:30: the next batch.
    expect(daily.current()[0]!.id).toBe(`daily_${batch + 1}_1`);
    expect(daily.msUntilNextBatch()).toBe(5.5 * HOUR_MS);
  });

  it('deals as many as configured, as often as configured', () => {
    const { driving, daily } = setup({ count: 3, refreshHours: 24 });
    driving.start(DEFAULT_GAME_CONFIG.newGame.startingVehicleId, DEFAULT_GAME_CONFIG.newGame.startingMapId);

    expect(daily.current()).toHaveLength(3);
    expect(daily.current()[0]!.id).toBe(`daily_${Math.floor(MORNING_MS / (24 * HOUR_MS))}_1`);
    expect(daily.refreshHours).toBe(24);
  });
});
