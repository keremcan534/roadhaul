import { describe, expect, it } from 'vitest';
import {
  createPedestrianPose,
  crowdShows,
  placePedestrians,
  walkerAt,
  WALKERS_PER_100_METERS,
} from '../../../../src/domain/world/pedestrians';
import { createRoadPoint, RoadPath } from '../../../../src/domain/world/RoadPath';
import { SIDEWALK_WIDTH_METERS, type Sidewalk, type StreetFurniture } from '../../../../src/domain/world/townscape';

/** A street 10 m wide running east (+x) from -100 to 100. */
const street = new RoadPath({
  id: 'high',
  kind: 'street',
  widthMeters: 10,
  closed: false,
  controlPoints: [
    [-100, 0],
    [100, 0],
  ],
});
/** Pavements along both sides, 150 m and 40 m long. */
const sidewalks: Sidewalk[] = [
  { roadIndex: 0, side: 1, fromMeters: 20, toMeters: 170 },
  { roadIndex: 0, side: -1, fromMeters: 100, toMeters: 140 },
];
const busStop: StreetFurniture = { kind: 'busStop', x: 10, z: -7, heading: 0, radius: 1 };
const bench: StreetFurniture = { kind: 'bench', x: 30, z: -7, heading: 0, radius: 1 };

describe('pedestrians', () => {
  it('puts walkers along every pavement, as many as its length asks, and a few waiting at each bus stop', () => {
    const people = placePedestrians([street], sidewalks, [busStop, bench], 7);

    const along = (index: number): number => people.walkers.filter((walker) => walker.sidewalk === index).length;
    expect(along(0)).toBe(Math.round(1.5 * WALKERS_PER_100_METERS));
    expect(along(1)).toBeGreaterThanOrEqual(1);
    expect(people.waiting.length).toBeGreaterThanOrEqual(1);
    expect(people.waiting.length).toBeLessThanOrEqual(3);
    // Near the shelter, in front of it: none at the bench.
    for (const waiting of people.waiting) {
      expect(Math.hypot(waiting.x - busStop.x, waiting.z - busStop.z)).toBeLessThan(2.5);
    }
    expect(placePedestrians([street], sidewalks, [busStop, bench], 7)).toEqual(people);
  });

  it('walks each one up its pavement and back, keeping to its right, facing the way it goes', () => {
    const walker = { sidewalk: 0, startMeters: 0, speed: 1.5, keepRight: 0.45, presence: 0, look: 0 };
    const sidewalk = sidewalks[0]!;
    const pose = createPedestrianPose();
    const point = createRoadPoint();
    const at = (seconds: number) => ({ ...walkerAt(walker, street, sidewalk, seconds, point, pose) });
    const middle = 5 + SIDEWALK_WIDTH_METERS / 2;

    // Setting out east along the pavement on the street's right (south, -z... the side the road's right normal
    // points to), on its right-hand half.
    const out = at(10);
    expect(out.x).toBeCloseTo(-100 + 20 + 15, 6);
    expect(Math.abs(out.z)).toBeCloseTo(middle + 0.45, 6);
    expect(Math.sin(out.heading)).toBeCloseTo(1, 6);
    // On the way back (150 m out, then 15 back): facing west, on the other half of the pavement.
    const back = at(110);
    expect(back.x).toBeCloseTo(-100 + 170 - 15, 6);
    expect(Math.abs(back.z)).toBeCloseTo(middle - 0.45, 6);
    expect(Math.sin(back.heading)).toBeCloseTo(-1, 6);
    // Always on the pavement, and striding as it walks.
    for (let seconds = 0; seconds < 400; seconds += 7) {
      const pose = at(seconds);
      expect(Math.abs(pose.z)).toBeGreaterThan(5);
      expect(Math.abs(pose.z)).toBeLessThan(5 + SIDEWALK_WIDTH_METERS);
      expect(pose.x).toBeGreaterThanOrEqual(-100 + 20 - 1e-6);
      expect(pose.x).toBeLessThanOrEqual(-100 + 170 + 1e-6);
    }
    expect(at(0.3).stride).not.toBe(at(0).stride);
  });

  it('thins the crowd: fewer out the thinner it is', () => {
    const people = placePedestrians([street], sidewalks, [busStop], 3);
    const shown = (crowd: number) => people.walkers.filter((walker) => crowdShows(walker.presence, crowd)).length;

    expect(shown(1)).toBe(people.walkers.length);
    expect(shown(0)).toBe(0);
    expect(shown(0.3)).toBeLessThan(shown(1));
  });
});
