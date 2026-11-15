import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { RoadDirtService } from '../../../../src/systems/vehicles/RoadDirtService';
import { MemoryLogger } from '../../../support/MemoryLogger';

const CONFIG = DEFAULT_GAME_CONFIG.roadDirt;

function setup() {
  const events = new EventBus<GameEvents>(new MemoryLogger());
  const conditions = { driving: true, speedMetersPerSecond: 20, wetness: 0, snowy: false, offRoad: false };
  const service = new RoadDirtService(CONFIG, conditions, events);
  const levels: string[] = [];
  events.on('TruckDirtChanged', ({ level }) => levels.push(level));
  const cleaned: number[] = [];
  events.on('TruckCleaned', ({ dirt }) => cleaned.push(dirt));
  /** Drives `meters` at the conditions' speed, a second at a time. */
  const drive = (meters: number): void => {
    for (let left = meters; left > 0; left -= conditions.speedMetersPerSecond) {
      service.update(Math.min(1, left / conditions.speedMetersPerSecond));
    }
  };
  return { service, conditions, levels, cleaned, drive };
}

describe('RoadDirtService', () => {
  it('dirties the truck as it drives, by the road, until it is caked', () => {
    const { service, conditions, levels, drive } = setup();
    drive(CONFIG.dryKilometers * 100);
    expect(service.dirt).toBeCloseTo(0.1, 6);
    expect(service.level).toBe('clean');
    conditions.wetness = 1;
    drive(CONFIG.dryKilometers * 100);
    expect(service.dirt).toBeCloseTo(0.1 + 0.1 * CONFIG.wetFactor, 6);
    expect(levels).toEqual(['dusty']);
    conditions.offRoad = true;
    drive(CONFIG.dryKilometers * 1000);
    expect(service.dirt).toBe(1);
    expect(levels).toEqual(['dusty', 'dirty', 'filthy']);
  });

  it('stays as it is while not driven (the menus, a race), or standing still', () => {
    const { service, conditions, drive } = setup();
    conditions.driving = false;
    drive(10_000);
    expect(service.dirt).toBe(0);
    conditions.driving = true;
    conditions.speedMetersPerSecond = 0;
    service.update(60);
    expect(service.dirt).toBe(0);
  });

  it('is washed by the share scrubbed clean, and keeps a truck\'s dirt as the garage hands it', () => {
    const { service, levels, cleaned } = setup();
    service.restore(0.8);
    expect(service.level).toBe('filthy');
    service.wash(0.5);
    expect(service.dirt).toBeCloseTo(0.4, 9);
    expect(service.level).toBe('dusty');
    service.wash(1);
    expect(service.dirt).toBe(0);
    expect(cleaned).toEqual([expect.closeTo(0.4, 9), 0]);
    expect(levels).toEqual(['dusty', 'clean']);
    // Nothing to wash: nothing said.
    service.wash(1);
    expect(cleaned).toHaveLength(2);
    service.restore(7);
    expect(service.dirt).toBe(1);
    service.restore(Number.NaN);
    expect(service.dirt).toBe(0);
  });
});
