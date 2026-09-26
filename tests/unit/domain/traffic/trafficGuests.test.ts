import { describe, expect, it } from 'vitest';
import type { TrafficVehicleDefinition } from '../../../../src/data/definitions/TrafficVehicleDefinition';
import type { LaneGraph } from '../../../../src/domain/traffic/LaneGraph';
import { laneRouteTo, type LaneRoute } from '../../../../src/domain/traffic/laneRoutes';
import { TrafficSimulation, type TrafficSettings } from '../../../../src/domain/traffic/TrafficSimulation';
import { createVehicleFootprint } from '../../../../src/domain/vehicles/VehicleFootprint';
import { trafficVehicleFixture, vehicleFixture } from '../../../support/contentFixtures';
import { crossingStreets, laneAt, laneGraphOf } from '../../../support/trafficFixtures';

const CAR = trafficVehicleFixture({ id: 'car', lengthMeters: 4.2, widthMeters: 1.8 });
const LORRY = trafficVehicleFixture({ id: 'lorry', kind: 'truck', lengthMeters: 8, widthMeters: 2.4, colors: [0x7a8b99] });
const TYPES: readonly TrafficVehicleDefinition[] = [CAR, LORRY];
const CAR_TYPE = 0;
const LORRY_TYPE = 1;
const FOOTPRINT = createVehicleFootprint(vehicleFixture().body);
const STEP = 1 / 60;
const SCENE: TrafficSettings = { maxVehicles: 8, radiusMeters: 5000, minSpawnDistanceMeters: 100, autoSpawn: false };
const RED = 0xd9363e;
const GUEST_ID = 7;

interface Truck {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

/** Off the roads south-west of the crossing, facing south: the crossing's east arm is behind it, out of sight. */
function lookingAway(): Truck {
  return { x: -100, z: -150, heading: Math.PI, speed: 0 };
}

/** The crossing's traffic, with the truck known (one step run). */
function crossing(settings: TrafficSettings = SCENE, truck: Truck = lookingAway()): { graph: LaneGraph; sim: TrafficSimulation } {
  const graph = laneGraphOf(crossingStreets());
  const sim = new TrafficSimulation(graph, TYPES, settings, 12345);
  sim.update(STEP, truck, FOOTPRINT);
  return { graph, sim };
}

function run(sim: TrafficSimulation, truck: Truck, seconds: number, each?: () => void): void {
  for (let step = 0; step < Math.round(seconds / STEP); step++) {
    sim.update(STEP, truck, FOOTPRINT);
    each?.();
  }
}

/** A lorry on the crossing's east arm, heading west for the junction, bound for `route`'s end. */
function addWestbound(sim: TrafficSimulation, route: LaneRoute): number {
  return sim.addGuest(GUEST_ID, LORRY_TYPE, RED, 150, 1, -Math.PI / 2, route);
}

describe('TrafficSimulation guests', () => {
  it('brings a company truck into the traffic out of sight, in its own colour, on the lane it drives', () => {
    const { graph, sim } = crossing();
    const slot = addWestbound(sim, laneRouteTo(graph, -150, 12, 10));

    expect(slot).toBeGreaterThanOrEqual(0);
    expect(sim.active[slot]).toBe(1);
    expect(sim.guest[slot]).toBe(GUEST_ID);
    expect(sim.type[slot]).toBe(LORRY_TYPE);
    expect(sim.color[slot]).toBe(RED);
    expect(sim.link[slot]).toBe(laneAt(graph, 100, 0, -90));
    expect(sim.x[slot]).toBeCloseTo(150, 0);
    expect(sim.z[slot]).toBeCloseTo(-2.5, 6); // Heading -X, the right-hand lane is at -Z.
  });

  it('takes the way to where it is going at the junction: left, straight on or right', () => {
    for (const [x, z, lane] of [
      [12, 150, [0, 100, 0]],
      [-150, 12, [-100, 0, -90]],
      [12, -150, [0, -100, 180]],
    ] as const) {
      const { graph, sim } = crossing();
      const slot = addWestbound(sim, laneRouteTo(graph, x, z, 10));
      const visited = new Set<number>();
      run(sim, lookingAway(), 30, () => {
        if (sim.active[slot] === 1) visited.add(sim.link[slot]!);
      });
      expect(visited.has(laneAt(graph, lane[0], lane[1], lane[2])), `bound for (${x}, ${z})`).toBe(true);
    }
  });

  it('drives on once it is there while in sight, and leaves the road once out of sight', () => {
    const { graph, sim } = crossing();
    const route = laneRouteTo(graph, 12, 150, 10);
    const slot = addWestbound(sim, route);
    const north = laneAt(graph, 0, 100, 0);
    // The truck, nearer the crossing, looks north up the arm the lorry is bound for.
    const truck: Truck = { x: -40, z: -40, heading: 0, speed: 0 };
    let arrived = false;
    for (let step = 0; step < 40 / STEP && !arrived; step++) {
      sim.update(STEP, truck, FOOTPRINT);
      arrived = sim.link[slot] === north && sim.s[slot]! >= route.arriveAt[north]!;
    }
    expect(arrived).toBe(true);

    run(sim, truck, 3);
    expect(sim.active[slot]).toBe(1);
    expect(sim.guest[slot]).toBe(GUEST_ID);

    truck.heading = Math.PI;
    sim.update(STEP, truck, FOOTPRINT);
    expect(sim.active[slot]).toBe(0);
  });

  it('comes only out of sight, beyond the nearest new traffic and within the traffic\'s reach, onto a lane with room', () => {
    const route = (graph: LaneGraph): LaneRoute => laneRouteTo(graph, -150, 12, 10);
    // In sight of the truck looking east along the arm.
    const watched = crossing(SCENE, { x: 0, z: -20, heading: Math.PI / 4, speed: 0 });
    expect(addWestbound(watched.sim, route(watched.graph))).toBe(-1);
    // Too near, and beyond the traffic's reach.
    const near = crossing(SCENE, { x: 150, z: 60, heading: 0, speed: 0 });
    expect(addWestbound(near.sim, route(near.graph))).toBe(-1);
    const small = crossing({ ...SCENE, radiusMeters: 200 });
    expect(addWestbound(small.sim, route(small.graph))).toBe(-1);
    // Off the roads, or the other way along the lane beside it.
    const { graph, sim } = crossing();
    expect(sim.addGuest(GUEST_ID, LORRY_TYPE, RED, 150, 40, -Math.PI / 2, route(graph))).toBe(-1);
    expect(sim.addGuest(GUEST_ID, LORRY_TYPE, RED, 150, 40, 0, route(graph))).toBe(-1);
    // A vehicle already there.
    sim.addVehicle(CAR_TYPE, laneAt(graph, 100, 0, -90), graph.length[laneAt(graph, 100, 0, -90)]! - 150 - 2, 0);
    expect(addWestbound(sim, route(graph))).toBe(-1);
  });

  it('makes room when every slot is taken: a vehicle of the traffic\'s own out of sight leaves, never one in sight', () => {
    const { graph, sim } = crossing({ ...SCENE, maxVehicles: 2 });
    const behind = sim.addVehicle(CAR_TYPE, laneAt(graph, 0, 100, 0), 20, 0); // North arm: behind the truck.
    const seen = sim.addVehicle(CAR_TYPE, laneAt(graph, 0, -100, 180), 150, 0); // South arm, just ahead of it.
    const slot = addWestbound(sim, laneRouteTo(graph, -150, 12, 10));

    expect(slot).toBe(behind);
    expect(sim.guest[slot]).toBe(GUEST_ID);
    expect(sim.active[seen]).toBe(1);
    // Only the guest and one in sight: no room for another guest.
    expect(sim.addGuest(8, LORRY_TYPE, RED, -150, -1, Math.PI / 2, laneRouteTo(graph, 150, 12, 10))).toBe(-1);
  });

  it('lets a guest go: it drives on as the traffic\'s own, and leaves the road once out of sight', () => {
    const { graph, sim } = crossing();
    const slot = addWestbound(sim, laneRouteTo(graph, -150, 12, 10));
    const truck: Truck = { x: 0, z: -60, heading: Math.PI / 4, speed: 0 }; // Looking at it.

    sim.releaseGuest(slot);
    expect(sim.guest[slot]).toBe(-1);
    run(sim, truck, 1);
    expect(sim.active[slot]).toBe(1);
    truck.heading = Math.PI;
    run(sim, truck, STEP);
    expect(sim.active[slot]).toBe(0);
  });
});
