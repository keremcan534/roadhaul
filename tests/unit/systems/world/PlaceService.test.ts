import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import type { PlaceDefinition } from '../../../../src/data/definitions/MapDefinition';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import type { MoneyReason } from '../../../../src/systems/economy/EconomyService';
import { NO_PLACES, PlaceService } from '../../../../src/systems/world/PlaceService';
import { MemoryLogger } from '../../../support/MemoryLogger';

const DAY_MS = 24 * 60 * 60 * 1000;
const DINER: PlaceDefinition = { id: 'test_diner', kind: 'diner', lot: { x: 0, z: 100, headingDegrees: 90, lengthMeters: 44, widthMeters: 30 } };
const WASH: PlaceDefinition = { id: 'test_wash', kind: 'truckWash', lot: { x: 0, z: -100, headingDegrees: 90, lengthMeters: 44, widthMeters: 30 } };
const config = DEFAULT_GAME_CONFIG.places;

function setup() {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const vehicle = { x: 0, z: 0, speed: 0 };
  const driving = {
    isDriving: true,
    vehicle: vehicle as never,
    world: {
      placeAt: (x: number, z: number) => [DINER, WASH].find((place) => Math.abs(place.lot.x - x) < 20 && Math.abs(place.lot.z - z) < 14) ?? null,
    },
  };
  const earned: [number, MoneyReason][] = [];
  const economy = { earn: (amount: number, reason: MoneyReason) => earned.push([amount, reason]) };
  let xp = 0;
  const company = { award: (amount: number) => (xp += amount) };
  // Noon on day 20,400 of the epoch, UTC; the player three hours ahead.
  const clock = { nowMs: 20_400 * DAY_MS + 12 * 3_600_000, now: () => clock.nowMs };
  const service = new PlaceService(driving, economy, company, config, clock, 180, events, logger);
  const found: GameEvents['PlaceFound'][] = [];
  events.on('PlaceFound', (event) => found.push(event));
  const park = (x: number, z: number, speed = 0) => {
    vehicle.x = x;
    vehicle.z = z;
    vehicle.speed = speed;
    service.update();
  };
  return { service, driving, earned, xp: () => xp, clock, found, park, events };
}

describe('PlaceService', () => {
  it('knows the place the truck stands still on, and none while it rolls through or is elsewhere', () => {
    const { service, park } = setup();

    park(0, 0);
    expect(service.current).toBeNull();
    park(3, 100, 6);
    expect(service.current).toBeNull();
    park(3, 100);
    expect(service.current).toBe(DINER);
    park(0, -100);
    expect(service.current).toBe(WASH);
  });

  it('pays the finder\'s reward on the first stop at each place, once', () => {
    const { service, park, earned, xp, found } = setup();

    park(0, 100);
    park(0, 0, 10);
    park(0, 100); // Back again.
    park(0, -100);

    expect(found).toEqual([
      { placeId: 'test_diner', kind: 'diner', credits: config.findCredits, xp: config.findXp },
      { placeId: 'test_wash', kind: 'truckWash', credits: config.findCredits, xp: config.findXp },
    ]);
    expect(earned).toEqual([
      [config.findCredits, 'place'],
      [config.findCredits, 'place'],
    ]);
    expect(xp()).toBe(2 * config.findXp);
    expect(service.isFound('test_diner')).toBe(true);
    expect(service.foundCount).toBe(2);
  });

  it('pays the day\'s puzzle once a day, the player\'s own day', () => {
    const { service, clock, earned } = setup();
    const day = service.puzzleDay;
    expect(day).toBe(20_400);

    expect(service.solvePuzzle(day, 14)).toEqual({ ok: true, value: { credits: config.puzzleCredits, xp: config.puzzleXp } });
    expect(service.puzzleSolvedToday).toBe(true);
    expect(service.solvePuzzle(day, 12)).toEqual({ ok: false, error: 'alreadySolved' });

    // Past the player's midnight (21:00 UTC, three hours ahead): a new day, and yesterday's yard no longer pays.
    clock.nowMs += 9.5 * 3_600_000;
    expect(service.puzzleDay).toBe(20_401);
    expect(service.puzzleSolvedToday).toBe(false);
    expect(service.solvePuzzle(day, 10)).toEqual({ ok: false, error: 'notToday' });
    expect(service.solvePuzzle(20_401, 10).ok).toBe(true);
    expect(earned.map(([amount]) => amount)).toEqual([config.puzzleCredits, config.puzzleCredits]);
  });

  it('tips a truck scrubbed clean enough, once a day', () => {
    const { service, earned, events } = setup();
    const washed: GameEvents['TruckWashed'][] = [];
    events.on('TruckWashed', (event) => washed.push(event));

    expect(service.finishWash(config.washCleanShare - 0.05)).toEqual({ ok: false, error: 'notClean' });
    expect(service.finishWash(config.washCleanShare)).toEqual({ ok: true, value: config.washCredits });
    expect(service.washedToday).toBe(true);
    expect(service.finishWash(1)).toEqual({ ok: false, error: 'alreadyWashed' });

    expect(earned).toEqual([[config.washCredits, 'place']]);
    expect(washed).toEqual([{ credits: config.washCredits }]);
  });

  it('saves what was found and the days of the puzzle and the wash, and takes them back', () => {
    const first = setup();
    first.park(0, -100);
    first.service.solvePuzzle(first.service.puzzleDay, 11);
    const saved = first.service.snapshot();

    const second = setup();
    second.service.restore(saved);
    second.park(0, -100); // Found before: no reward again.

    expect(saved).toEqual({ found: ['test_wash'], puzzleDay: 20_400, washDay: null });
    expect(second.found).toEqual([]);
    expect(second.service.puzzleSolvedToday).toBe(true);
    expect(second.service.washedToday).toBe(false);
    second.service.restore(NO_PLACES);
    expect(second.service.foundCount).toBe(0);
  });

  it('knows no place while nothing is driven', () => {
    const { service, park, driving } = setup();
    park(0, 100);

    driving.isDriving = false;
    service.update();

    expect(service.current).toBeNull();
  });
});
