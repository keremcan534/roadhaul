import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../../src/data/content/maps';
import { rectangleContains } from '../../../../src/data/definitions/MapDefinition';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import {
  MAX_RUN_POINTS,
  rectangleCorners,
  simplifyPolyline,
  SIMPLIFY_TOLERANCE_METERS,
  sketchWorld,
  splitRuns,
} from '../../../../src/ui/map/mapSketch';

const world = new DrivingWorld(MAPS[0]!);
const sketch = sketchWorld(world);

/** Distance from (x, z) to the nearest piece of a polyline (x and z interleaved). */
function distanceToPolyline(points: Float64Array, x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 3 < points.length; i += 2) {
    const ax = points[i]!;
    const az = points[i + 1]!;
    const dx = points[i + 2]! - ax;
    const dz = points[i + 3]! - az;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}

describe('simplifyPolyline', () => {
  it('keeps the ends and the corners, and drops points on straight lines', () => {
    const line = new Float64Array([0, 0, 10, 0, 20, 0, 30, 0, 30, 10, 30, 20]);
    expect([...simplifyPolyline(line, 0.5)]).toEqual([0, 0, 30, 0, 30, 20]);
    expect([...simplifyPolyline(new Float64Array([1, 2, 3, 4]), 0.5)]).toEqual([1, 2, 3, 4]);
  });

  it('stays within the tolerance of the line it simplifies', () => {
    const arc = new Float64Array(200);
    for (let i = 0; i < 100; i++) {
      arc[i * 2] = 300 * Math.cos(i / 40);
      arc[i * 2 + 1] = 300 * Math.sin(i / 40);
    }
    const simplified = simplifyPolyline(arc, 1.5);
    expect(simplified.length).toBeLessThan(arc.length / 2);
    for (let i = 0; i < 100; i++) {
      expect(distanceToPolyline(simplified, arc[i * 2]!, arc[i * 2 + 1]!)).toBeLessThanOrEqual(1.5 + 1e-9);
    }
  });
});

describe('splitRuns', () => {
  it('cuts a line into runs that meet end to start, with their bounds', () => {
    const points = new Float64Array(20);
    for (let i = 0; i < 10; i++) {
      points[i * 2] = i * 10;
      points[i * 2 + 1] = i % 2;
    }
    const runs = splitRuns('street', 7, points, 4);
    expect(runs.map((run) => run.points.length / 2)).toEqual([4, 4, 4]);
    expect(runs[1]!.points[0]).toBe(runs[0]!.points[6]);
    expect(runs[2]!.points[6]).toBe(90);
    expect(runs[0]).toMatchObject({ kind: 'street', widthMeters: 7, minX: 0, maxX: 30, minZ: 0, maxZ: 1 });
  });
});

describe('rectangleCorners', () => {
  it('finds the corners of a turned rectangle, as the ground knows it', () => {
    for (const headingDegrees of [0, 30, 90, 145, -60]) {
      const rectangle = { x: 40, z: -25, headingDegrees, lengthMeters: 60, widthMeters: 24 };
      const { corners, minX, maxX, minZ, maxZ } = rectangleCorners(rectangle);
      for (let i = 0; i < 8; i += 2) {
        const x = corners[i]!;
        const z = corners[i + 1]!;
        expect(rectangleContains(rectangle, x, z, 1e-9)).toBe(true);
        // A little further from the middle is outside.
        expect(rectangleContains(rectangle, 40 + (x - 40) * 1.02, -25 + (z + 25) * 1.02)).toBe(false);
        expect(x >= minX && x <= maxX && z >= minZ && z <= maxZ).toBe(true);
      }
    }
  });
});

describe('sketchWorld', () => {
  it('draws every road within the tolerance, in short runs', () => {
    for (const run of sketch.runs) {
      expect(run.points.length / 2).toBeLessThanOrEqual(MAX_RUN_POINTS);
      expect(run.points.length / 2).toBeGreaterThanOrEqual(2);
    }
    for (const road of world.roads) {
      const runs = sketch.runs.filter((run) => run.kind === road.kind);
      for (let i = 0; i < road.pointCount; i += 7) {
        const nearest = Math.min(...runs.map((run) => distanceToPolyline(run.points, road.x(i), road.z(i))));
        expect(nearest, `${road.id} sample ${i}`).toBeLessThanOrEqual(SIMPLIFY_TOLERANCE_METERS + 1e-9);
      }
    }
    // Far fewer points than the road samples: cheap to draw ten times a second.
    const drawn = sketch.runs.reduce((sum, run) => sum + run.points.length / 2, 0);
    const sampled = world.roads.reduce((sum, road) => sum + road.pointCount, 0);
    expect(drawn).toBeLessThan(sampled / 3);
  });

  it('has the depots, the rest area and a name for each city near its depot', () => {
    expect(sketch.depots.map((depot) => depot.id)).toEqual(world.depots.map((depot) => depot.id));
    expect(sketch.restAreas.map((restArea) => restArea.id)).toEqual(world.restAreas.map((restArea) => restArea.id));
    expect(sketch.cities.map((city) => city.cityId)).toEqual(world.depots.map((depot) => depot.cityId));
    sketch.cities.forEach((city, index) => {
      const depot = sketch.depots[index]!;
      expect(Math.hypot(city.x - depot.x, city.z - depot.z)).toBeLessThan(800);
    });
    expect(sketch.buildings).toHaveLength(world.buildings.length);
    // Every yard and lot is paved on the map, and the turning circles too.
    expect(sketch.pavedAreas).toHaveLength(world.depots.length + world.restAreas.length);
    expect(sketch.turningCircles).toHaveLength(world.turningCircles.length);
  });

  it('has the farm fields with their crops, and the wind turbines', () => {
    expect(sketch.fields.map((field) => field.crop)).toEqual(world.fields.map((field) => field.crop));
    sketch.fields.forEach((field, index) => {
      const { area } = world.fields[index]!;
      // Four corners round the field's middle.
      expect(field.corners).toHaveLength(8);
      expect((field.minX + field.maxX) / 2).toBeCloseTo(area.x, 6);
      expect((field.minZ + field.maxZ) / 2).toBeCloseTo(area.z, 6);
    });
    expect(sketch.windTurbines).toEqual(world.windTurbines.map(({ x, z }) => ({ x, z })));
  });

  it('frames everything it draws', () => {
    const { bounds } = sketch;
    const inside = (x: number, z: number): boolean => x > bounds.minX && x < bounds.maxX && z > bounds.minZ && z < bounds.maxZ;
    for (const run of sketch.runs) {
      expect(inside(run.minX, run.minZ) && inside(run.maxX, run.maxZ)).toBe(true);
    }
    for (const place of [...sketch.depots, ...sketch.restAreas, world.spawn]) {
      expect(inside(place.x, place.z)).toBe(true);
    }
  });
});
