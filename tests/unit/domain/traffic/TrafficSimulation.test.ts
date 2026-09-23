import { describe, expect, it } from 'vitest';
import { GAME_CONTENT } from '../../../../src/data/content';
import type { TrafficVehicleDefinition } from '../../../../src/data/definitions/TrafficVehicleDefinition';
import type { LaneGraph } from '../../../../src/domain/traffic/LaneGraph';
import {
  TrafficSimulation,
  type TrafficBehaviour,
  type TrafficSettings,
} from '../../../../src/domain/traffic/TrafficSimulation';
import { createVehicleFootprint } from '../../../../src/domain/vehicles/VehicleFootprint';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { trafficVehicleFixture, vehicleFixture } from '../../../support/contentFixtures';
import {
  alongAt,
  crossingStreets,
  laneAt,
  laneGraphOf,
  straightStreet,
  TEST_SPEED_LIMITS,
} from '../../../support/trafficFixtures';

const CAR = trafficVehicleFixture({ id: 'car', lengthMeters: 4.2, widthMeters: 1.8, accelerationMetersPerSecondSquared: 2 });
const BUS = trafficVehicleFixture({
  id: 'bus',
  kind: 'bus',
  lengthMeters: 11,
  widthMeters: 2.5,
  accelerationMetersPerSecondSquared: 1,
});
const TYPES: readonly TrafficVehicleDefinition[] = [CAR, BUS];
const CAR_TYPE = 0;
const BUS_TYPE = 1;
/** The test truck: 9 m long, 2.5 m wide, circles from 2 m behind its rear axle to 7 m ahead of it. */
const FOOTPRINT = createVehicleFootprint(vehicleFixture().body);
const STEP = 1 / 60;
/** Scenes: nothing appears by itself and nothing is recycled. */
const SCENE: TrafficSettings = { maxVehicles: 8, radiusMeters: 5000, minSpawnDistanceMeters: 100, autoSpawn: false };

interface Truck {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

/** A truck far from every road, out of the way. */
function parkedAway(): Truck {
  return { x: 900, z: 900, heading: 0, speed: 0 };
}

function scene(graph: LaneGraph, settings: TrafficSettings = SCENE, types = TYPES): TrafficSimulation {
  return new TrafficSimulation(graph, types, settings, 12345);
}

/** Steps `seconds` of simulation, calling `each` after every step. */
function run(sim: TrafficSimulation, truck: Truck, seconds: number, each?: (time: number) => void): void {
  for (let step = 1; step <= Math.round(seconds / STEP); step++) {
    sim.update(STEP, truck, FOOTPRINT);
    each?.(step * STEP);
  }
}

/** Closest approach between vehicle `i`'s circles and the truck's, minus both radii: negative when touching. */
function clearanceToTruck(sim: TrafficSimulation, i: number, truck: Truck): number {
  let clearance = Infinity;
  for (let c = 0; c < sim.circleCount; c++) {
    if (Math.hypot(sim.circleX[c]! - sim.x[i]!, sim.circleZ[c]! - sim.z[i]!) > 10) continue; // Another vehicle's.
    for (const offset of FOOTPRINT.offsets) {
      const tx = truck.x + Math.sin(truck.heading) * offset;
      const tz = truck.z + Math.cos(truck.heading) * offset;
      const distance = Math.hypot(sim.circleX[c]! - tx, sim.circleZ[c]! - tz) - sim.circleRadius[c]! - FOOTPRINT.radius;
      clearance = Math.min(clearance, distance);
    }
  }
  return clearance;
}

function behaviours(sim: TrafficSimulation, i: number, seen: Set<TrafficBehaviour>): void {
  seen.add(sim.behaviourOf(i));
}

describe('TrafficSimulation', () => {
  it('cruises in its lane at its share of the speed limit', () => {
    const graph = laneGraphOf(straightStreet());
    const sim = scene(graph);
    const car = sim.addVehicle(CAR_TYPE, laneAt(graph, 0, 0, 0), 20, 0, 0.9);

    run(sim, parkedAway(), 14);

    expect(sim.speed[car]).toBeCloseTo(TEST_SPEED_LIMITS.street * 0.9, 0);
    expect(sim.x[car]).toBeCloseTo(-2.5, 6); // Right of +Z is -X.
    expect(sim.heading[car]).toBeCloseTo(0, 6);
    expect(sim.behaviourOf(car)).toBe('cruise');
  });

  it('follows a slower vehicle at a safe gap without touching it', () => {
    const graph = laneGraphOf(straightStreet());
    const sim = scene(graph);
    const lane = laneAt(graph, 0, 0, 0);
    const bus = sim.addVehicle(BUS_TYPE, lane, 80, 4, 0.3);
    const car = sim.addVehicle(CAR_TYPE, lane, 10, 11);
    const seen = new Set<TrafficBehaviour>();
    let closest = Infinity;

    run(sim, parkedAway(), 30, () => {
      closest = Math.min(closest, sim.s[bus]! - sim.s[car]! - BUS.lengthMeters / 2 - CAR.lengthMeters / 2);
      behaviours(sim, car, seen);
    });

    expect(closest).toBeGreaterThan(2);
    expect(sim.speed[car]).toBeCloseTo(sim.speed[bus]!, 0);
    expect(seen).toContain('follow');
  });

  it('stops behind the truck standing in its lane, then drives round it through the clear lane beside', () => {
    const graph = laneGraphOf(straightStreet());
    const sim = scene(graph);
    const truck: Truck = { x: -2.5, z: 0, heading: 0, speed: 0 };
    const car = sim.addVehicle(CAR_TYPE, laneAt(graph, 0, -100, 0), 20, 12);
    const seen = new Set<TrafficBehaviour>();
    let closest = Infinity;
    let widest = -Infinity;
    let passedAt = -1;

    run(sim, truck, 40, (time) => {
      closest = Math.min(closest, clearanceToTruck(sim, car, truck));
      widest = Math.max(widest, sim.x[car]!);
      behaviours(sim, car, seen);
      if (passedAt < 0 && sim.z[car]! > 30) passedAt = time;
    });

    expect(closest).toBeGreaterThan(0.3);
    expect(seen).toContain('stop');
    expect(seen).toContain('avoid');
    expect(widest).toBeGreaterThan(2); // Through the other lane (+X)…
    expect(passedAt).toBeGreaterThan(0);
    expect(sim.x[car]).toBeCloseTo(-2.5, 1); // …and back in its own.
  });

  it('waits behind a truck that blocks both lanes', () => {
    const graph = laneGraphOf(straightStreet());
    const sim = scene(graph);
    // Across the road, from one edge to the other.
    const truck: Truck = { x: -3, z: 0, heading: Math.PI / 2, speed: 0 };
    const car = sim.addVehicle(CAR_TYPE, laneAt(graph, 0, -100, 0), 20, 12);
    const seen = new Set<TrafficBehaviour>();
    let closest = Infinity;

    run(sim, truck, 30, () => {
      closest = Math.min(closest, clearanceToTruck(sim, car, truck));
      behaviours(sim, car, seen);
    });

    expect(closest).toBeGreaterThan(0.3);
    expect(sim.speed[car]).toBe(0);
    expect(sim.behaviourOf(car)).toBe('stop');
    expect(seen).not.toContain('avoid');
  });

  it('turns round at a dead end and comes back in the other lane', () => {
    const graph = laneGraphOf(straightStreet());
    const sim = scene(graph);
    const north = laneAt(graph, 0, 0, 0);
    const car = sim.addVehicle(CAR_TYPE, north, graph.length[north]! - 60, 10);
    const seen = new Set<TrafficBehaviour>();

    run(sim, parkedAway(), 30, () => behaviours(sim, car, seen));

    expect(sim.link[car]).toBe(laneAt(graph, 0, 0, 180));
    expect(sim.x[car]).toBeCloseTo(2.5, 1);
    expect(Math.cos(sim.heading[car]!)).toBeCloseTo(-1, 2);
    expect(seen).toContain('turn');
  });

  it('overtakes a slower vehicle on the highway and pulls back into the right lane', () => {
    const graph = laneGraphOf(straightStreet(2400, 'highway', 14));
    const sim = scene(graph);
    const right = laneAt(graph, 0, -900, 0);
    const lorry = sim.addVehicle(BUS_TYPE, right, 300, 12, 0.5);
    const car = sim.addVehicle(CAR_TYPE, right, 150, 22);
    const seen = new Set<TrafficBehaviour>();
    let lorryZ = 0;

    run(sim, parkedAway(), 40, () => {
      behaviours(sim, car, seen);
      lorryZ = sim.z[lorry]!;
    });

    expect(seen).toContain('changeLane');
    expect(sim.z[car]).toBeGreaterThan(lorryZ + 50);
    expect(sim.link[car]).toBe(right);
    expect(sim.x[car]).toBeCloseTo(-5.25, 1);
  });

  it('brakes hard when the truck pulls out right in front, and stops short of it', () => {
    const graph = laneGraphOf(straightStreet());
    const sim = scene(graph);
    const lane = laneAt(graph, 0, 0, 0);
    const car = sim.addVehicle(CAR_TYPE, lane, alongAt(graph, lane, -2.5, -95), 12);
    // Standing in the other lane 30 m ahead, then swerving across into the car's lane in half a second.
    const truck: Truck = { x: 2.5, z: -68, heading: 0, speed: 0 };
    const seen = new Set<TrafficBehaviour>();
    let closest = Infinity;

    run(sim, truck, 8, (time) => {
      truck.x = Math.max(-2.5, 2.5 - 10 * time);
      closest = Math.min(closest, clearanceToTruck(sim, car, truck));
      behaviours(sim, car, seen);
    });

    expect(seen).toContain('emergencyStop');
    expect(closest).toBeGreaterThan(0);
    expect(sim.speed[car]).toBeLessThan(0.4);
  });

  it('stops when the truck hits it, and drives on after a while', () => {
    const graph = laneGraphOf(straightStreet());
    const sim = scene(graph);
    const car = sim.addVehicle(CAR_TYPE, laneAt(graph, 0, 0, 0), 20, 10);
    run(sim, parkedAway(), 0.5);
    let carCircle = -1;
    for (let c = 0; c < sim.circleCount && carCircle < 0; c++) {
      if (Math.hypot(sim.circleX[c]! - sim.x[car]!, sim.circleZ[c]! - sim.z[car]!) < 3) carCircle = c;
    }

    sim.hit(carCircle, 4);
    run(sim, parkedAway(), 0.1);
    expect(sim.behaviourOf(car)).toBe('emergencyStop');
    run(sim, parkedAway(), 3);
    expect(sim.speed[car]).toBe(0);
    run(sim, parkedAway(), 3);
    expect(sim.speed[car]).toBe(0); // Still waiting…
    run(sim, parkedAway(), 3);
    expect(sim.speed[car]).toBeGreaterThan(1); // …and off again.
  });

  it('takes turns at a busy crossing one conflicting turn at a time, so vehicles never run into each other', () => {
    const graph = laneGraphOf(crossingStreets());
    const sim = scene(graph, { maxVehicles: 14, radiusMeters: 5000, minSpawnDistanceMeters: 100 });
    let overlaps = 0;
    let stoppedNearCrossing = 0;

    run(sim, parkedAway(), 240, () => {
      for (let a = 0; a < sim.circleCount; a++) {
        for (let b = a + 1; b < sim.circleCount; b++) {
          const distance = Math.hypot(sim.circleX[a]! - sim.circleX[b]!, sim.circleZ[a]! - sim.circleZ[b]!);
          if (sim.circleOwner[a] !== sim.circleOwner[b] && distance < sim.circleRadius[a]! + sim.circleRadius[b]!) {
            overlaps++;
          }
        }
      }
      for (let i = 0; i < sim.capacity; i++) {
        if (sim.active[i] === 1 && sim.behaviourOf(i) === 'stop' && Math.hypot(sim.x[i]!, sim.z[i]!) < 25) {
          stoppedNearCrossing++;
        }
      }
    });

    expect(sim.vehicleCount).toBe(14);
    expect(overlaps).toBe(0);
    expect(stoppedNearCrossing).toBeGreaterThan(0);
  });

  it('gives way at a junction to the truck driving towards it', () => {
    const graph = laneGraphOf(crossingStreets());
    const sim = scene(graph);
    const fromSouth = laneAt(graph, 0, -50, 0);
    const car = sim.addVehicle(CAR_TYPE, fromSouth, graph.length[fromSouth]! - 45, 10);
    // Heading +X, traffic keeps to +Z: the truck crosses in front of the car at 12 m/s.
    const truck: Truck = { x: -90, z: 2.5, heading: Math.PI / 2, speed: 12 };
    const seen = new Set<TrafficBehaviour>();
    let closest = Infinity;
    let furthestWhileTruckApproaches = -Infinity;

    run(sim, truck, 20, () => {
      truck.x += truck.speed * STEP;
      closest = Math.min(closest, clearanceToTruck(sim, car, truck));
      behaviours(sim, car, seen);
      if (truck.x < 0) {
        furthestWhileTruckApproaches = Math.max(furthestWhileTruckApproaches, sim.z[car]!);
      }
    });

    expect(seen).toContain('stop');
    expect(furthestWhileTruckApproaches).toBeLessThan(-8); // It waited at the line…
    expect(closest).toBeGreaterThan(1);
    expect(sim.link[car]).not.toBe(fromSouth); // …and went on after.
  });

  it('does not wait at a junction for the truck that is following it', () => {
    const graph = laneGraphOf(crossingStreets());
    const sim = scene(graph);
    const fromSouth = laneAt(graph, 0, -50, 0);
    const car = sim.addVehicle(CAR_TYPE, fromSouth, graph.length[fromSouth]! - 45, 8);
    const truck: Truck = { x: -2.5, z: -75, heading: 0, speed: 3 };
    const seen = new Set<TrafficBehaviour>();

    run(sim, truck, 10, () => {
      truck.z += truck.speed * STEP;
      behaviours(sim, car, seen);
    });

    expect(seen).not.toContain('stop');
    expect(sim.link[car]).not.toBe(fromSouth);
  });

  describe('on the region map', () => {
    const world = new DrivingWorld(GAME_CONTENT.maps[0]!);
    const graph = laneGraphOf(world);
    const settings: TrafficSettings = { maxVehicles: 16, radiusMeters: 700, minSpawnDistanceMeters: 180 };
    const atSpawn = (): Truck => ({ x: world.spawn.x, z: world.spawn.z, heading: world.spawn.heading, speed: 0 });
    const distanceTo = (sim: TrafficSimulation, i: number, truck: Truck): number =>
      Math.hypot(sim.x[i]! - truck.x, sim.z[i]! - truck.z);

    it('fills the roads around the truck at once, clear of it', () => {
      const sim = scene(graph, settings, GAME_CONTENT.trafficVehicles);
      const truck = atSpawn();

      sim.update(STEP, truck, FOOTPRINT);

      expect(sim.vehicleCount).toBe(16);
      for (let i = 0; i < sim.capacity; i++) {
        expect(distanceTo(sim, i, truck)).toBeGreaterThan(55);
        expect(distanceTo(sim, i, truck)).toBeLessThan(700);
      }
    });

    it('brings new traffic in out of sight: far away, or behind the truck', () => {
      const sim = scene(graph, settings, GAME_CONTENT.trafficVehicles);
      const truck = atSpawn();
      sim.update(STEP, truck, FOOTPRINT);
      const known = new Set<number>(sim.serial);
      let arrivals = 0;

      // The truck drives north along the high street at 10 m/s for a minute.
      run(sim, truck, 60, () => {
        truck.z += 10 * STEP;
        truck.speed = 10;
        for (let i = 0; i < sim.capacity; i++) {
          if (sim.active[i] === 1 && !known.has(sim.serial[i]!)) {
            known.add(sim.serial[i]!);
            arrivals++;
            const distance = distanceTo(sim, i, truck);
            const ahead = (sim.z[i]! - truck.z) * Math.cos(truck.heading) + (sim.x[i]! - truck.x) * Math.sin(truck.heading);
            expect(distance).toBeGreaterThanOrEqual(180);
            expect(distance > 350 || ahead < 0, `${distance.toFixed(0)} m, ${ahead.toFixed(0)} m ahead`).toBe(true);
          }
        }
      });

      expect(arrivals).toBeGreaterThan(0);
    });

    it('recycles traffic left far behind and fills the roads round a truck placed somewhere else', () => {
      const sim = scene(graph, settings, GAME_CONTENT.trafficVehicles);
      const truck = atSpawn();
      run(sim, truck, 1);

      // Placed at city C's depot, 2.5 km away (a new game, or the debug key).
      truck.x = 300;
      truck.z = 1484.5;
      sim.update(STEP, truck, FOOTPRINT);

      expect(sim.vehicleCount).toBeGreaterThan(10);
      for (let i = 0; i < sim.capacity; i++) {
        if (sim.active[i] === 1) {
          expect(distanceTo(sim, i, truck)).toBeLessThan(700 + 80);
          expect(distanceTo(sim, i, truck)).toBeGreaterThan(45);
        }
      }
    });

    it('is repeatable: the same seed gives the same traffic', () => {
      const first = scene(graph, settings, GAME_CONTENT.trafficVehicles);
      const second = scene(graph, settings, GAME_CONTENT.trafficVehicles);

      run(first, atSpawn(), 20);
      run(second, atSpawn(), 20);

      expect([...second.x]).toEqual([...first.x]);
      expect([...second.z]).toEqual([...first.z]);
    });
  });

  it('has no traffic when there may be no vehicles', () => {
    const graph = laneGraphOf(straightStreet());
    const sim = new TrafficSimulation(graph, TYPES, { maxVehicles: 0, radiusMeters: 700, minSpawnDistanceMeters: 180 }, 1);

    run(sim, parkedAway(), 1);

    expect(sim.capacity).toBe(0);
    expect(sim.vehicleCount).toBe(0);
    expect(sim.circleCount).toBe(0);
    expect(sim.addVehicle(CAR_TYPE, 0, 10, 0)).toBe(-1);
  });

  it('gives every vehicle a row of collision circles along its body, moving with it', () => {
    const graph = laneGraphOf(straightStreet());
    const sim = scene(graph);
    const lane = laneAt(graph, 0, 0, 0);
    sim.addVehicle(CAR_TYPE, lane, 30, 8);
    sim.addVehicle(BUS_TYPE, lane, 120, 0);

    sim.update(STEP, parkedAway(), FOOTPRINT);

    // A 4.2 × 1.8 m car: 3 circles of 0.9 m; an 11 × 2.5 m bus: 5 of 1.25 m.
    expect(sim.circleCount).toBe(8);
    const radii = [...sim.circleRadius.subarray(0, 8)];
    expect(radii.filter((radius) => radius === 0.9)).toHaveLength(3);
    expect(radii.filter((radius) => radius === 1.25)).toHaveLength(5);
    for (let c = 0; c < 3; c++) {
      expect(sim.circleX[c]).toBeCloseTo(-2.5, 6);
      expect(sim.circleVelocityZ[c]).toBeCloseTo(sim.speed[0]!, 6);
    }
    expect(Math.max(...sim.circleZ.subarray(0, 3)) - Math.min(...sim.circleZ.subarray(0, 3))).toBeCloseTo(4.2 - 1.8, 6);
  });
});
