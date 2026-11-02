import { describe, expect, it } from 'vitest';
import { GAME_CONTENT } from '../../../../src/data/content';
import { TrafficSimulation } from '../../../../src/domain/traffic/TrafficSimulation';
import {
  AMBER_LIGHT,
  GREEN_LIGHT,
  placeTrafficSignals,
  RED_LIGHT,
  SIGNAL_ALL_RED_SECONDS,
  SIGNAL_AMBER_SECONDS,
  SIGNAL_CYCLE_SECONDS,
  signalLight,
} from '../../../../src/domain/traffic/trafficSignals';
import { createVehicleFootprint } from '../../../../src/domain/vehicles/VehicleFootprint';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { vehicleFixture } from '../../../support/contentFixtures';
import { laneGraphOf } from '../../../support/trafficFixtures';

const metropol = new DrivingWorld(GAME_CONTENT.maps.find((map) => map.id === 'metropol')!);
const graph = laneGraphOf(metropol);
const signals = placeTrafficSignals(graph, metropol)!;

describe('signalLight', () => {
  it('turns the two ways green in turn, each through amber, with a moment of red both ways between', () => {
    let both = 0;
    const seen = [new Set<number>(), new Set<number>()];
    for (let t = 0; t < 2 * SIGNAL_CYCLE_SECONDS; t += 0.25) {
      const a = signalLight(t, 0);
      const b = signalLight(t, 1);
      seen[0]!.add(a);
      seen[1]!.add(b);
      // Never green or amber both ways at once.
      expect(a === RED_LIGHT || b === RED_LIGHT, `${t} s`).toBe(true);
      both += a === RED_LIGHT && b === RED_LIGHT ? 0.25 : 0;
    }
    expect(seen[0]).toEqual(new Set([GREEN_LIGHT, AMBER_LIGHT, RED_LIGHT]));
    expect(seen[1]).toEqual(new Set([GREEN_LIGHT, AMBER_LIGHT, RED_LIGHT]));
    expect(both).toBeGreaterThan(0);
    expect(signalLight(0, 0)).toBe(GREEN_LIGHT);
    expect(signalLight(SIGNAL_CYCLE_SECONDS, 0)).toBe(GREEN_LIGHT);
    expect(signalLight(-1, 0)).toBe(signalLight(SIGNAL_CYCLE_SECONDS - 1, 0));
  });
});

describe('placeTrafficSignals', () => {
  it('puts none on a map without them (North Valley)', () => {
    const valley = new DrivingWorld(GAME_CONTENT.maps[0]!);
    expect(placeTrafficSignals(laneGraphOf(valley), valley)).toBeNull();
  });

  it('lights Metropol\'s street crossings, a head beside each way in, on the kerb facing the traffic', () => {
    expect(signals.junctionCount).toBeGreaterThan(60);
    expect(signals.heads.length).toBeGreaterThan(signals.junctionCount * 2.5);
    for (const head of signals.heads) {
      // Off the asphalt of every road, within a few meters of the nearest one's edge.
      const edges = metropol.roads.map((road) => road.distanceTo(head.x, head.z) - road.widthMeters / 2);
      const nearest = Math.min(...edges);
      expect(nearest, `head at ${Math.round(head.x)}, ${Math.round(head.z)}`).toBeGreaterThan(0.3);
      expect(nearest).toBeLessThan(3);
    }
    // None where the motorway meets the boulevards and the avenue.
    const motorway = metropol.roads.findIndex((road) => road.id === 'm1_motorway');
    for (const junction of metropol.network.junctions.filter((candidate) => candidate.members.some((member) => member.roadIndex === motorway))) {
      expect(signals.heads.some((head) => Math.hypot(head.x - junction.x, head.z - junction.z) < 40)).toBe(false);
    }
  });
});

describe('the traffic at the lights', () => {
  it('stops at red and goes on green, and never jams: six minutes round downtown', () => {
    const footprint = createVehicleFootprint(vehicleFixture().body);
    const sim = new TrafficSimulation(
      graph,
      GAME_CONTENT.trafficVehicles,
      { maxVehicles: 16, radiusMeters: 600, minSpawnDistanceMeters: 150, signals },
      11,
    );
    // The truck parked off the road in the park: the traffic round it on the grid.
    const park = metropol.parks.find((candidate) => candidate.id === 'halverton_park')!.area;
    const truck = { x: park.x, z: park.z, heading: 0, speed: 0 };
    const step = 1 / 60;
    const still = new Map<number, number>();
    let longestStill = 0;
    let stoppedAtRed = 0;
    let crossedOnGreen = 0;
    const wasOnLane = new Map<number, number>();
    for (let k = 0; k < 6 * 60 * 60; k++) {
      sim.update(step, truck, footprint);
      if (k % 30 !== 0) {
        continue;
      }
      for (let i = 0; i < sim.capacity; i++) {
        if (sim.active[i] !== 1) {
          continue;
        }
        const serial = sim.serial[i]!;
        const link = sim.link[i]!;
        const group = signals.groupOf[link]!;
        const stood = Math.abs(sim.speed[i]!) < 0.2 ? (still.get(serial) ?? 0) + 0.5 : 0;
        still.set(serial, stood);
        longestStill = Math.max(longestStill, stood);
        if (group >= 0 && stood > 0 && graph.length[link]! - sim.s[i]! < 12 && signalLight(sim.signalSeconds, group) === RED_LIGHT) {
          stoppedAtRed++;
        }
        // Into a junction from a lane with lights, once the first vehicles (some spawned too near a line to stop) are
        // through: on green or amber, or just after, too close to stop when it turned; never well into a red.
        const before = wasOnLane.get(serial);
        if (sim.signalSeconds > 10 && before !== undefined && before !== link && signals.groupOf[before]! >= 0 && graph.isTurn(link)) {
          const group = signals.groupOf[before]!;
          const lateBy = SIGNAL_AMBER_SECONDS + SIGNAL_ALL_RED_SECONDS + 1;
          expect(signalLight(sim.signalSeconds - lateBy, group) === RED_LIGHT && signalLight(sim.signalSeconds - 0.5, group) === RED_LIGHT, `vehicle ${serial}`).toBe(false);
          crossedOnGreen++;
        }
        wasOnLane.set(serial, link);
      }
    }
    expect(stoppedAtRed).toBeGreaterThan(0);
    expect(crossedOnGreen).toBeGreaterThan(0);
    expect(longestStill).toBeLessThan(90);
  }, 60_000);
});
