import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { SeededRandom } from '../../../../src/core/random/SeededRandom';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { GAME_CONTENT } from '../../../../src/data/content';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import type { Credits } from '../../../../src/data/units';
import { hitchFare } from '../../../../src/domain/roadside/hitchhike';
import { DrivingService } from '../../../../src/systems/driving/DrivingService';
import type { MoneyReason } from '../../../../src/systems/economy/EconomyService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { HitchhikerService } from '../../../../src/systems/world/HitchhikerService';
import { STEP_SECONDS } from '../../../support/driving';
import { MemoryLogger } from '../../../support/MemoryLogger';

const content = ContentCatalog.create(GAME_CONTENT);
const config = DEFAULT_GAME_CONFIG.hitchhikers;

function setup() {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const driving = new DrivingService(content, events, logger);
  driving.start(content.vehicles.all[0]!.id, 'north_valley');
  const earned: [Credits, MoneyReason][] = [];
  let xp = 0;
  const luck = new SeededRandom(7);
  const service = new HitchhikerService(
    driving,
    { earn: (amount, reason) => earned.push([amount, reason]) },
    { award: (amount) => (xp += amount) },
    config,
    () => luck.next(),
    events,
    logger,
  );
  const seen: string[] = [];
  events.on('HitchhikerAppeared', () => seen.push('appeared'));
  events.on('HitchhikerPickedUp', ({ cityId }) => seen.push(`picked up for ${cityId}`));
  events.on('HitchhikerDroppedOff', ({ cityId, fare }) => seen.push(`dropped off in ${cityId} for ${fare}`));
  return { service, driving, events, earned, seen, xp: () => xp };
}

/** Steps the service `seconds` with the truck where it is. */
function wait(service: HitchhikerService, seconds: number) {
  for (let t = 0; t < seconds - 1e-9; t += STEP_SECONDS) {
    service.update(STEP_SECONDS);
  }
}

// Each test builds a game world (a few seconds on a busy machine).
describe('HitchhikerService', { timeout: 60_000 }, () => {
  it('sends someone to wait by a road ahead of the truck, bound for a town some way off', () => {
    const { service, driving, seen } = setup();
    expect(service.stage).toBe('none');
    service.sendHitchhiker();
    wait(service, STEP_SECONDS);

    expect(service.stage).toBe('waiting');
    expect(seen).toEqual(['appeared']);
    const truck = driving.vehicle;
    const distance = service.distanceMeters;
    expect(distance).toBeGreaterThan(config.aheadMeters[0] - 30);
    expect(distance).toBeLessThan(config.aheadMeters[1] + 30);
    // Ahead of the truck, by the road but off it.
    expect((service.spot.x - truck.x) * Math.sin(truck.heading) + (service.spot.z - truck.z) * Math.cos(truck.heading)).toBeGreaterThan(0);
    expect(driving.world.roads.some((road) => road.contains(service.spot.x, service.spot.z))).toBe(false);
    // Where they are going is told once they are in the cab.
    expect(service.destination).toBeNull();
  });

  it('picks them up when the truck stops beside them, and pays the fare where they get out', () => {
    const { service, driving, earned, seen, xp } = setup();
    service.sendHitchhiker();
    wait(service, STEP_SECONDS);
    driving.placeTruck(service.spot.x + 4, service.spot.z, 0);
    wait(service, config.stopSeconds + 0.1);

    expect(service.stage).toBe('riding');
    const destination = service.destination!;
    expect(seen[1]).toBe(`picked up for ${destination.cityId}`);
    expect(destination.meters).toBeGreaterThanOrEqual(config.tripMeters[0]);
    expect(destination.meters).toBeLessThanOrEqual(config.tripMeters[1]);

    // Not yet: still far from their town.
    wait(service, 5);
    expect(earned).toEqual([]);
    // Stopped near their town's depot: out they get, paying.
    driving.placeTruck(destination.x + 40, destination.z, 0);
    wait(service, config.stopSeconds + 0.1);
    const fare = hitchFare(destination.meters, config.baseFare, config.farePerKm);
    expect(service.stage).toBe('none');
    expect(earned).toEqual([[fare, 'roadside']]);
    expect(xp()).toBe(config.xp);
    expect(seen[2]).toBe(`dropped off in ${destination.cityId} for ${fare}`);
  });

  it('lets them walk on when the truck drives by, or keeps them waiting too long', () => {
    const passed = setup();
    passed.service.sendHitchhiker();
    wait(passed.service, STEP_SECONDS);
    const { x, z } = passed.service.spot;
    passed.driving.placeTruck(x + 2000, z, 0);
    wait(passed.service, STEP_SECONDS);
    expect(passed.service.stage).toBe('none');

    const kept = setup();
    kept.service.sendHitchhiker();
    wait(kept.service, STEP_SECONDS);
    wait(kept.service, config.waitSeconds + 1);
    expect(kept.service.stage).toBe('none');
  });

  it('starts over with nobody about when a company is started or continued from the main menu', () => {
    const { service, driving, events } = setup();
    service.sendHitchhiker();
    wait(service, STEP_SECONDS);
    driving.placeTruck(service.spot.x + 4, service.spot.z, 0);
    wait(service, config.stopSeconds + 0.1);
    expect(service.stage).toBe('riding');

    events.emit('GameStateChanged', { previous: 'mainMenu', current: 'driving' });
    expect(service.stage).toBe('none');
    expect(service.destination).toBeNull();
  });
});
