import { describe, expect, it } from 'vitest';
import { rectangleContains, type ParkDefinition } from '../../../../src/data/definitions/MapDefinition';
import {
  hedgeWalls,
  layoutPark,
  onParkPath,
  PARK_FOUNTAIN_RADIUS_METERS,
  PARK_PATH_WIDTH_METERS,
  PARK_PLAZA_RADIUS_METERS,
} from '../../../../src/domain/world/parks';

const along: ParkDefinition = { id: 'test_park', area: { x: 10, z: -20, headingDegrees: 0, lengthMeters: 100, widthMeters: 60 } };
const turned: ParkDefinition = { id: 'turned_park', area: { x: 10, z: -20, headingDegrees: 90, lengthMeters: 100, widthMeters: 60 } };

/** Distance from (x, z) to the segment a → b. */
function toSegment(x: number, z: number, a: readonly [number, number], b: readonly [number, number]): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
}

describe('a park', () => {
  for (const definition of [along, turned]) {
    const { park, trees, furniture, lamps } = layoutPark(definition, 5);
    const { area } = definition;
    const label = `heading ${area.headingDegrees}°`;

    it(`crosses its lawn with two paths meeting at a fountain in its middle (${label})`, () => {
      expect(park.paths).toHaveLength(2);
      for (const { a, b } of park.paths) {
        // From edge to edge through the middle.
        expect(toSegment(area.x, area.z, a, b)).toBeCloseTo(0, 9);
        expect(rectangleContains(area, a[0], a[1], 0.01)).toBe(true);
        expect(rectangleContains(area, a[0], a[1], -0.01)).toBe(false);
      }
      const lengths = park.paths.map(({ a, b }) => Math.hypot(b[0] - a[0], b[1] - a[1])).sort((p, q) => p - q);
      expect(lengths[0]).toBeCloseTo(area.widthMeters, 9);
      expect(lengths[1]).toBeCloseTo(area.lengthMeters, 9);
      expect(park.fountain).toEqual({ x: area.x, z: area.z, radius: PARK_FOUNTAIN_RADIUS_METERS });
      expect(onParkPath(park, area.x + PARK_PLAZA_RADIUS_METERS - 0.5, area.z)).toBe(true);
    });

    it(`hedges it round, open where the paths come in (${label})`, () => {
      expect(park.hedges).toHaveLength(8);
      for (const { a, b } of park.hedges) {
        expect(rectangleContains(area, a[0], a[1])).toBe(true);
        expect(rectangleContains(area, b[0], b[1])).toBe(true);
        for (const path of park.paths) {
          // No run reaches across a path's end.
          for (const end of [path.a, path.b]) {
            expect(toSegment(end[0], end[1], a, b)).toBeGreaterThan(PARK_PATH_WIDTH_METERS / 2);
          }
        }
      }
      for (const wall of hedgeWalls(park)) {
        // Each wall faces out of the park.
        const middle = [(wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2] as const;
        expect(rectangleContains(area, middle[0] + wall.nx * 2, middle[1] + wall.nz * 2)).toBe(false);
      }
    });

    it(`rings its lawn with trees, clear of its paths and plaza (${label})`, () => {
      expect(trees.length).toBeGreaterThan(20);
      for (const tree of trees) {
        expect(rectangleContains(area, tree.x, tree.z, -2)).toBe(true);
        expect(onParkPath(park, tree.x, tree.z, 2)).toBe(false);
      }
    });

    it(`sets benches beside its paths, facing them, bins beside some, and lamps along them (${label})`, () => {
      const benches = furniture.filter((piece) => piece.kind === 'bench');
      expect(benches.length).toBeGreaterThanOrEqual(8);
      expect(furniture.filter((piece) => piece.kind === 'bin').length).toBeGreaterThan(0);
      for (const piece of [...furniture, ...lamps]) {
        expect(rectangleContains(area, piece.x, piece.z, -1)).toBe(true);
        expect(onParkPath(park, piece.x, piece.z)).toBe(false);
        expect(onParkPath(park, piece.x, piece.z, 1.5)).toBe(true);
      }
      for (const bench of benches) {
        // A step forward brings it nearer its path.
        const ahead = { x: bench.x + Math.sin(bench.heading), z: bench.z + Math.cos(bench.heading) };
        const nearest = (x: number, z: number): number => Math.min(...park.paths.map(({ a, b }) => toSegment(x, z, a, b)));
        expect(nearest(ahead.x, ahead.z)).toBeLessThan(nearest(bench.x, bench.z));
      }
      expect(lamps.length).toBeGreaterThanOrEqual(4);
    });
  }

  it('is laid out the same from the same seed', () => {
    expect(layoutPark(along, 5)).toEqual(layoutPark(along, 5));
  });
});
