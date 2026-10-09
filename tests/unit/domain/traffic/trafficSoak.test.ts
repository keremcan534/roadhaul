import { describe, expect, it } from 'vitest';
import { GAME_CONTENT } from '../../../../src/data/content';
import { TrafficSimulation } from '../../../../src/domain/traffic/TrafficSimulation';
import { createVehicleFootprint } from '../../../../src/domain/vehicles/VehicleFootprint';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { vehicleFixture } from '../../../support/contentFixtures';
import { laneGraphOf } from '../../../support/trafficFixtures';

const STEP = 1 / 60;
/** Checked twice a second of game time. */
const CHECK_EVERY_STEPS = 30;

describe('the region traffic over a long session', () => {
  it('keeps flowing for twelve minutes round the truck at each depot in turn: no overlaps, no jams, no bad numbers', () => {
    const world = new DrivingWorld(GAME_CONTENT.maps[0]!);
    const graph = laneGraphOf(world);
    const footprint = createVehicleFootprint(vehicleFixture().body);
    const sim = new TrafficSimulation(graph, GAME_CONTENT.trafficVehicles, { maxVehicles: 16, radiusMeters: 700, minSpawnDistanceMeters: 180 }, 7);
    const spots = [...world.depots.map((depot) => depot.bay), world.spawn];
    const truck = { x: world.spawn.x, z: world.spawn.z, heading: world.spawn.heading, speed: 0 };
    /** Seconds each vehicle (by serial) has stood still. */
    const still = new Map<number, number>();
    let worstOverlap = 0;
    let longestStill = 0;

    for (let step = 0; step < 12 * 60 * 60; step++) {
      // The truck parks somewhere new every two minutes: the traffic is cleared and filled round it.
      const spot = spots[Math.floor(step / (120 * 60)) % spots.length]!;
      truck.x = spot.x;
      truck.z = spot.z;
      sim.update(STEP, truck, footprint);
      if (step % CHECK_EVERY_STEPS !== 0) {
        continue;
      }
      for (let i = 0; i < sim.capacity; i++) {
        if (sim.active[i] !== 1) {
          continue;
        }
        expect(Number.isFinite(sim.x[i]!) && Number.isFinite(sim.z[i]!) && Number.isFinite(sim.speed[i]!)).toBe(true);
        const serial = sim.serial[i]!;
        const stood = Math.abs(sim.speed[i]!) < 0.2 ? (still.get(serial) ?? 0) + CHECK_EVERY_STEPS * STEP : 0;
        still.set(serial, stood);
        longestStill = Math.max(longestStill, stood);
      }
      for (let a = 0; a < sim.circleCount; a++) {
        for (let b = a + 1; b < sim.circleCount; b++) {
          if (sim.circleOwner[a] !== sim.circleOwner[b]) {
            const gap =
              Math.hypot(sim.circleX[a]! - sim.circleX[b]!, sim.circleZ[a]! - sim.circleZ[b]!) - sim.circleRadius[a]! - sim.circleRadius[b]!;
            worstOverlap = Math.min(worstOverlap, gap);
          }
        }
      }
    }

    expect(worstOverlap).toBeGreaterThan(-0.3);
    // Waiting at a junction or behind a turning bus is fine; a minute and a half is a jam.
    expect(longestStill).toBeLessThan(90);
  }, 60_000);
});
