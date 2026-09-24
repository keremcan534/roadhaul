import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../../../../src/core/random/SeededRandom';
import { MAPS } from '../../../../src/data/content/maps';
import type { RoadDefinition } from '../../../../src/data/definitions/MapDefinition';
import { RoadGrid } from '../../../../src/domain/world/RoadGrid';
import { RoadPath } from '../../../../src/domain/world/RoadPath';

const straight: RoadDefinition = {
  id: 'straight',
  kind: 'street',
  widthMeters: 10,
  closed: false,
  controlPoints: [
    [-150, 0],
    [150, 0],
  ],
};

const loop: RoadDefinition = {
  id: 'loop',
  kind: 'street',
  widthMeters: 8,
  closed: true,
  controlPoints: [
    [-100, -100],
    [100, -100],
    [100, 100],
    [-100, 100],
  ],
};

/** The answers of the grid, worked out the slow way: from every piece of every road. */
function slowlyOnRoad(roads: readonly RoadPath[], x: number, z: number): boolean {
  return roads.some((road) => road.distanceTo(x, z) <= road.widthMeters / 2);
}

function slowlyNearRoad(roads: readonly RoadPath[], x: number, z: number, clearance: number): boolean {
  return roads.some((road) => road.distanceTo(x, z) < road.widthMeters / 2 + clearance);
}

describe('RoadGrid', () => {
  it('tells the road from beside it like measuring against every piece, on the shipped map', () => {
    const roads = MAPS[0]!.roads.map((road) => new RoadPath(road));
    const grid = new RoadGrid(roads, 4);
    const random = new SeededRandom(27);
    let onRoad = 0;

    // Points near the centrelines, where the edges are, and a few anywhere on the map.
    for (let i = 0; i < 3000; i++) {
      const road = roads[random.int(0, roads.length - 1)]!;
      const sample = random.int(0, road.pointCount - 1);
      const x = road.x(sample) + random.range(-14, 14);
      const z = road.z(sample) + random.range(-14, 14);
      expect(grid.onRoad(x, z)).toBe(slowlyOnRoad(roads, x, z));
      expect(grid.nearRoad(x, z, 3.5)).toBe(slowlyNearRoad(roads, x, z, 3.5));
      onRoad += grid.onRoad(x, z) ? 1 : 0;
    }
    const half = MAPS[0]!.halfSizeMeters;
    for (let i = 0; i < 300; i++) {
      const x = random.range(-half, half);
      const z = random.range(-half, half);
      expect(grid.onRoad(x, z)).toBe(slowlyOnRoad(roads, x, z));
    }
    // Both answers came up plenty of times.
    expect(onRoad).toBeGreaterThan(600);
    expect(onRoad).toBeLessThan(2400);
  });

  it('finds the edges of a road, round its ends too', () => {
    const grid = new RoadGrid([new RoadPath(straight)], 2);

    // 10 m wide along the X axis, from x = -150 to x = 150.
    expect(grid.onRoad(0, 4.9)).toBe(true);
    expect(grid.onRoad(0, -5.1)).toBe(false);
    expect(grid.nearRoad(0, 6.9, 2)).toBe(true);
    expect(grid.nearRoad(0, -7.1, 2)).toBe(false);
    expect(grid.onRoad(154.9, 0)).toBe(true);
    expect(grid.onRoad(155.1, 0)).toBe(false);
    expect(grid.onRoad(5000, -5000)).toBe(false);
  });

  it('knows the piece that closes a loop', () => {
    const road = new RoadPath(loop);
    const grid = new RoadGrid([road], 2);
    const last = road.segmentCount - 1;

    expect(grid.onRoad((road.x(last) + road.x(0)) / 2, (road.z(last) + road.z(0)) / 2)).toBe(true);
    expect(grid.onRoad(0, 0)).toBe(false);
  });

  it('refuses to look farther from the roads than it was built for', () => {
    const grid = new RoadGrid([new RoadPath(loop)], 2);

    expect(() => grid.nearRoad(0, 0, 2.5)).toThrow('The road grid looks 2 m from the roads, not 2.5 m.');
  });
});
