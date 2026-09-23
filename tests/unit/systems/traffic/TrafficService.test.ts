import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { DEFAULT_GAME_CONFIG, type GameConfig } from '../../../../src/data/config/GameConfig';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import { DrivingService } from '../../../../src/systems/driving/DrivingService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { TrafficService } from '../../../../src/systems/traffic/TrafficService';
import { contentFixture } from '../../../support/contentFixtures';
import { input, STEP_SECONDS } from '../../../support/driving';
import { MemoryLogger } from '../../../support/MemoryLogger';

function setup(traffic: Partial<GameConfig['traffic']> = {}) {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const collisions: number[] = [];
  events.on('VehicleCollided', ({ impactSpeedMetersPerSecond }) => collisions.push(impactSpeedMetersPerSecond));
  const content = ContentCatalog.create(contentFixture());
  const driving = new DrivingService(content, events, logger);
  const service = new TrafficService(driving, content, { ...DEFAULT_GAME_CONFIG.traffic, ...traffic }, logger);
  return { driving, service, collisions, logger };
}

describe('TrafficService', () => {
  it('has no traffic while no truck is driven', () => {
    const { service } = setup();

    service.update(STEP_SECONDS);

    expect(service.simulation).toBeNull();
  });

  it('fills the roads of a drive with traffic that keeps clear of the truck', () => {
    const { driving, service } = setup({ maxVehicles: 4 });
    driving.start('test_truck', 'test_map');

    service.update(STEP_SECONDS);

    const simulation = service.simulation!;
    expect(simulation.vehicleCount).toBe(4);
    for (let i = 0; i < simulation.capacity; i++) {
      expect(Math.hypot(simulation.x[i]! - driving.vehicle.x, simulation.z[i]! - driving.vehicle.z)).toBeGreaterThan(55);
    }
  });

  it('makes the traffic something the truck crashes into: head-on on the wrong side of the road', () => {
    const { driving, service, collisions } = setup({ maxVehicles: 4 });
    driving.start('test_truck', 'test_map');
    service.update(STEP_SECONDS);
    // The fixture road runs along X; heading +X, traffic keeps to +Z. Put the truck in the lane coming the other way.
    driving.placeTruck(-60, -2.5, Math.PI / 2);
    const simulation = service.simulation!;
    const oncoming = [...simulation.active.keys()].filter(
      (i) => simulation.active[i] === 1 && Math.sin(simulation.heading[i]!) < -0.9 && simulation.x[i]! > -60,
    );
    expect(oncoming.length).toBeGreaterThan(0);

    for (let step = 0; step < 20 / STEP_SECONDS && collisions.length === 0; step++) {
      service.update(STEP_SECONDS);
      driving.step(STEP_SECONDS, input({ throttle: 1 }));
    }

    expect(collisions.length).toBe(1);
    const hit = oncoming.find((i) => Math.hypot(simulation.x[i]! - driving.vehicle.x, simulation.z[i]! - driving.vehicle.z) < 12);
    expect(hit).toBeDefined();
    service.update(STEP_SECONDS);
    expect(simulation.behaviourOf(hit!)).toBe('emergencyStop');
  });

  it('starts fresh traffic for every drive, on the lanes already laid for its map', () => {
    const { driving, service, logger } = setup();
    driving.start('test_truck', 'test_map');
    service.update(STEP_SECONDS);
    const first = service.simulation!;

    driving.start('test_truck', 'test_map');
    service.update(STEP_SECONDS);

    expect(service.simulation).not.toBe(first);
    expect(service.simulation!.graph).toBe(first.graph);
    expect(logger.entries.filter((entry) => entry.message.startsWith('Traffic lanes for test_map'))).toHaveLength(1);
  });

  it('keeps the roads empty when traffic is turned off', () => {
    const { driving, service } = setup({ maxVehicles: 0 });
    driving.start('test_truck', 'test_map');

    service.update(STEP_SECONDS);

    expect(service.simulation!.vehicleCount).toBe(0);
  });

  it('lets go of the traffic when disposed', () => {
    const { driving, service } = setup();
    driving.start('test_truck', 'test_map');
    service.update(STEP_SECONDS);

    service.dispose();

    expect(service.simulation).toBeNull();
  });
});
