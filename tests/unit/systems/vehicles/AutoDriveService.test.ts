import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { NO_PERKS } from '../../../../src/domain/company/facilities';
import { RED_LIGHT, signalLight, SIGNAL_CYCLE_SECONDS, type TrafficSignals } from '../../../../src/domain/traffic/trafficSignals';
import { createVehicleInput } from '../../../../src/domain/vehicles/VehicleInput';
import type { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { AutoDriveService } from '../../../../src/systems/vehicles/AutoDriveService';
import { vehicleFixture } from '../../../support/contentFixtures';
import { MemoryLogger } from '../../../support/MemoryLogger';

/** A straight rural road along +z from the truck, `meters` of it, a sample every 2 m. */
function straightRoute(meters: number, fromZ = 0) {
  const count = Math.floor(meters / 2) + 1;
  const x = new Float64Array(count);
  const z = Float64Array.from({ length: count }, (_, k) => fromZ + k * 2);
  const along = Float64Array.from({ length: count }, (_, k) => k * 2);
  return { count, x, z, road: new Int32Array(count), along, distanceMeters: meters };
}

function setup(options: { researched?: boolean; unlocked?: boolean; routeMeters?: number } = {}) {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  // In the right-hand lane of the road along +z: 1.75 m to its right, at −x.
  const vehicle = { x: -1.75, z: 0, heading: 0, speed: 0 };
  let parkingBrake = true;
  const driving = {
    isDriving: true,
    vehicle: vehicle as never,
    definition: vehicleFixture(),
    world: { roads: [{ kind: 'rural', widthMeters: 7 }] } as unknown as DrivingWorld,
    get parkingBrake() {
      return parkingBrake;
    },
    setParkingBrake: (applied: boolean) => {
      parkingBrake = applied;
    },
  };
  const navigation = { hasRoute: true, route: straightRoute(options.routeMeters ?? 600) as ReturnType<typeof straightRoute> | null };
  const capacity = 4;
  const simulation = {
    capacity,
    active: new Uint8Array(capacity),
    x: new Float64Array(capacity),
    z: new Float64Array(capacity),
    heading: new Float64Array(capacity),
    speed: new Float64Array(capacity),
  };
  const traffic = { simulation, signals: null as TrafficSignals | null, signalSeconds: 0 as number | null, signalsOf: () => traffic.signals };
  const roadEvents = { workZoneLimitKmh: 0, cameraAheadLimitKmh: -1, cameraAheadMeters: -1 };
  const perks = { perks: { ...NO_PERKS, autoDrive: options.researched === false ? 0 : 1 } };
  const service = new AutoDriveService(
    driving,
    navigation,
    traffic,
    roadEvents,
    perks,
    DEFAULT_GAME_CONFIG.traffic.speedLimitsKmh,
    options.unlocked ?? false,
    events,
    logger,
  );
  const changes: GameEvents['AutoDriveChanged'][] = [];
  events.on('AutoDriveChanged', (event) => changes.push(event));
  return { service, vehicle, driving, navigation, simulation, traffic, roadEvents, changes, parkingBrake: () => parkingBrake };
}

/** One step with the driver's hands off: what auto-drive writes. */
function step(service: AutoDriveService, seconds = 1 / 60) {
  const input = createVehicleInput();
  service.update(seconds, input);
  return input;
}

describe('AutoDriveService', () => {
  it('is earned in research (or unlocked for testing), never there without it', () => {
    expect(setup({ researched: false }).service.engage()).toEqual({ ok: false, error: 'locked' });
    expect(setup({ researched: false }).service.available).toBe(false);
    expect(setup({ researched: false, unlocked: true }).service.engage().ok).toBe(true);
    expect(setup().service.available).toBe(true);
  });

  it('takes the wheel only with a route to follow, the truck on the road along it, and not just short of the yard', () => {
    const noRoute = setup();
    noRoute.navigation.hasRoute = false;
    expect(noRoute.service.engage()).toEqual({ ok: false, error: 'noRoute' });

    const inTheYard = setup();
    inTheYard.vehicle.x = -25;
    expect(inTheYard.service.engage()).toEqual({ ok: false, error: 'offRoad' });

    expect(setup({ routeMeters: 60 }).service.engage()).toEqual({ ok: false, error: 'offRoad' });
  });

  it('drives off (the parking brake let off, the lever in drive), and gives the wheel back on a firm touch', () => {
    const { service, changes, parkingBrake } = setup();
    expect(service.engage().ok).toBe(true);

    const input = step(service);
    expect(parkingBrake()).toBe(false);
    expect(input.throttle).toBeGreaterThan(0);
    expect(input.brake).toBe(0);
    expect(input.lever).toBe('drive');
    expect(Math.abs(input.steer)).toBeLessThan(0.05);

    const touched = createVehicleInput();
    touched.steer = -0.8;
    service.update(1 / 60, touched);

    expect(service.engaged).toBe(false);
    expect(touched.steer).toBe(-0.8); // The driver's own, left alone.
    expect(changes).toEqual([
      { engaged: true, reason: null },
      { engaged: false, reason: 'takeover' },
    ]);
  });

  it('brakes for a vehicle standing in its lane ahead, not for one in the other lane', () => {
    const { service, vehicle, simulation } = setup();
    service.engage();
    vehicle.speed = 12;
    simulation.active[0] = 1;
    simulation.x[0] = 1.75; // The other lane.
    simulation.z[0] = 30;
    expect(step(service).brake).toBe(0);

    simulation.x[0] = -1.75; // Ours.
    const input = step(service);
    expect(input.throttle).toBe(0);
    expect(input.brake).toBeGreaterThan(0.3);
  });

  it('stops for a red light ahead, and drives on through a green one', () => {
    const { service, vehicle, traffic } = setup();
    service.engage();
    vehicle.speed = 10;
    traffic.signals = {
      groupOf: new Int8Array(0),
      heads: [],
      stopLines: [{ x: -1.75, z: 25, y: 0, dirX: 0, dirZ: 1, halfWidth: 1.75, group: 0 }],
      junctionCount: 1,
    };
    // Some time into the cycle when group 0 is red, and when it is green.
    let red = 0;
    while (signalLight(red, 0) !== RED_LIGHT) {
      red += 0.5;
    }
    traffic.signalSeconds = red;
    expect(step(service).brake).toBeGreaterThan(0.3);

    traffic.signalSeconds = SIGNAL_CYCLE_SECONDS; // Green again.
    expect(step(service).brake).toBe(0);
  });

  it('keeps to road works\' limit and slows ahead of a camera', () => {
    const { service, vehicle, roadEvents } = setup();
    service.engage();
    vehicle.speed = 18; // Under the rural limit, 70 km/h.
    expect(step(service).brake).toBe(0);

    roadEvents.workZoneLimitKmh = 40;
    expect(step(service).brake).toBeGreaterThan(0);

    roadEvents.workZoneLimitKmh = 0;
    roadEvents.cameraAheadLimitKmh = 30;
    roadEvents.cameraAheadMeters = 20;
    expect(step(service).brake).toBeGreaterThan(0);
  });

  it('hands the wheel back standing short of the yard, and when the route is gone', () => {
    const arriving = setup({ routeMeters: 100 });
    arriving.service.engage();
    arriving.navigation.route = straightRoute(70);
    step(arriving.service);
    expect(arriving.changes.at(-1)).toEqual({ engaged: false, reason: 'arrived' });

    const lost = setup();
    lost.service.engage();
    lost.navigation.hasRoute = false;
    step(lost.service);
    expect(lost.changes.at(-1)).toEqual({ engaged: false, reason: 'lostRoute' });
  });

  it('gives up standing still behind something it cannot see', () => {
    const { service, changes } = setup();
    service.engage();

    for (let second = 0; second < 9; second++) {
      step(service, 1);
    }

    expect(changes.at(-1)).toEqual({ engaged: false, reason: 'stuck' });
  });
});
