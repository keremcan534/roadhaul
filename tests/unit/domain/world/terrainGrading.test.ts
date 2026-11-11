import { describe, expect, it } from 'vitest';
import type { RoadDefinition } from '../../../../src/data/definitions/MapDefinition';
import { RoadPath } from '../../../../src/domain/world/RoadPath';
import { FLAT_TERRAIN } from '../../../../src/domain/world/terrain';
import { gradeTerrain, hillsHeight, MAX_ROAD_GRADE } from '../../../../src/domain/world/terrainGrading';

function road(id: string, kind: RoadDefinition['kind'], points: RoadDefinition['controlPoints'], extra: Partial<RoadDefinition> = {}): RoadPath {
  return new RoadPath({ id, kind, widthMeters: kind === 'highway' ? 14 : 8, closed: false, controlPoints: points, ...extra });
}

/** The steepest the road climbs or falls between two samples, rise per meter. */
function steepest(path: RoadPath): number {
  let worst = 0;
  for (let i = 1; i < path.pointCount; i++) {
    const run = path.distances[i]! - path.distances[i - 1]!;
    worst = Math.max(worst, Math.abs(path.heights[i]! - path.heights[i - 1]!) / run);
  }
  return worst;
}

const HILL = { x: 0, z: 0, radiusMeters: 600, heightMeters: 120 };

describe('grading the terrain and its roads', () => {
  it('leaves a map without hills flat, its roads at 0', () => {
    const flatRoad = road('a', 'rural', [
      [-500, 0],
      [500, 0],
    ]);

    expect(gradeTerrain(undefined, 1000, [flatRoad])).toBe(FLAT_TERRAIN);
    expect(gradeTerrain({ hills: [] }, 1000, [flatRoad])).toBe(FLAT_TERRAIN);
    expect(flatRoad.heights.every((height) => height === 0)).toBe(true);
  });

  it('raises the hills as smooth domes that add up', () => {
    expect(hillsHeight([HILL], 0, 0)).toBeCloseTo(120, 9);
    expect(hillsHeight([HILL], 300, 0)).toBeCloseTo(60, 9);
    expect(hillsHeight([HILL], 600, 0)).toBeCloseTo(0, 9);
    expect(hillsHeight([HILL, { ...HILL, heightMeters: 30 }], 0, 0)).toBeCloseTo(150, 9);
  });

  it('takes a road over a hill no steeper than a truck can climb, the ground level with it beside it and its own beyond', () => {
    const over = road('over', 'rural', [
      [-900, 0],
      [-300, 20],
      [300, -20],
      [900, 0],
    ]);
    const terrain = gradeTerrain({ hills: [HILL] }, 1000, [over]);

    expect(terrain.flat).toBe(false);
    expect(steepest(over)).toBeLessThanOrEqual(MAX_ROAD_GRADE + 1e-9);
    // It climbs: the crest is well above the plain.
    expect(Math.max(...over.heights)).toBeGreaterThan(60);
    for (let i = 0; i < over.pointCount; i += 10) {
      // On the road and its verge, the ground is the road's height.
      expect(Math.abs(terrain.heightAt(over.x(i), over.z(i)) - over.heights[i]!), `sample ${i}`).toBeLessThan(0.15);
    }
    // Far to the side of it, the hill as it was.
    expect(terrain.heightAt(0, 400)).toBeCloseTo(hillsHeight([HILL], 0, 400), 1);
  });

  it('meets a bigger road at its height where they join', () => {
    const highway = road('main', 'highway', [
      [-900, 100],
      [900, 100],
    ]);
    const side = road('side', 'lane', [
      [0, -900],
      [0, 100],
    ]);
    // Graded biggest first, whatever their order.
    gradeTerrain({ hills: [HILL] }, 1000, [side, highway]);

    const junction = side.pointCount - 1;
    const onHighway = highway.nearestSampleIndex(0, 100);
    expect(side.heights[junction]).toBeCloseTo(highway.heights[onHighway]!, 1);
    expect(steepest(side)).toBeLessThanOrEqual(MAX_ROAD_GRADE + 1e-9);
  });

  it('carries an overpass over a road on its deck, the ground left below it', () => {
    const highway = road('motorway', 'highway', [
      [-900, 0],
      [900, 0],
    ]);
    const bridge = road(
      'bridge',
      'street',
      [
        [0, -600],
        [0, 600],
      ],
      {
        profile: [
          { atMeters: 450, heightMeters: 0 },
          { atMeters: 560, heightMeters: 7.5 },
          { atMeters: 640, heightMeters: 7.5 },
          { atMeters: 750, heightMeters: 0 },
        ],
        elevated: [[540, 660]],
      },
    );
    const terrain = gradeTerrain(undefined, 1000, [highway, bridge]);

    const over = bridge.nearestSampleIndex(0, 0);
    expect(bridge.heights[over]).toBeCloseTo(7.5, 6);
    // The motorway under it, and the ground, stay at their own level.
    expect(highway.heights[highway.nearestSampleIndex(0, 0)]).toBeCloseTo(0, 6);
    expect(terrain.heightAt(0, 0)).toBeCloseTo(0, 6);
    // The ramps are graded up to the deck and back down.
    expect(terrain.heightAt(0, -60)).toBeGreaterThan(2);
    expect(steepest(bridge)).toBeLessThanOrEqual(MAX_ROAD_GRADE + 1e-9);
  });

  it('finds a road\'s height between its samples, a closed road wrapping round', () => {
    const ring = new RoadPath({
      id: 'ring',
      kind: 'ringRoad',
      widthMeters: 10,
      closed: true,
      controlPoints: [
        [-100, -100],
        [100, -100],
        [100, 100],
        [-100, 100],
      ],
    });
    for (let i = 0; i < ring.pointCount; i++) {
      ring.heights[i] = ring.distances[i]! / 10;
    }

    expect(ring.heightAtDistance(ring.distances[5]!)).toBeCloseTo(ring.distances[5]! / 10, 9);
    expect(ring.heightAtDistance((ring.distances[5]! + ring.distances[6]!) / 2)).toBeCloseTo((ring.distances[5]! + ring.distances[6]!) / 20, 9);
    // Past the last sample, back toward the first.
    const last = ring.distances[ring.pointCount - 1]!;
    expect(ring.heightAtDistance((last + ring.lengthMeters) / 2)).toBeCloseTo(last / 20, 6);
    expect(ring.heightAtDistance(ring.lengthMeters + ring.distances[5]!)).toBeCloseTo(ring.distances[5]! / 10, 9);
  });
});
