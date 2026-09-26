import { describe, expect, it } from 'vitest';
import type { ForestDefinition, ForestKind, RoadDefinition } from '../../../../src/data/definitions/MapDefinition';
import { Occupancy } from '../../../../src/domain/world/countryside';
import {
  createForest,
  distanceToForestEdge,
  FOREST_EDGE_BAND_METERS,
  forestContains,
  forestRoadside,
  FOREST_TRUNK_RADIUS_METERS,
  plantForest,
} from '../../../../src/domain/world/forests';
import { RoadPath } from '../../../../src/domain/world/RoadPath';

/** A square forest 200 m across round the origin. */
function square(kind: ForestKind, id = 'test_forest'): ForestDefinition {
  return {
    id,
    kind,
    outline: [
      [-100, -100],
      [100, -100],
      [100, 100],
      [-100, 100],
    ],
  };
}

const everywhere = (): boolean => true;

describe('a forest', () => {
  const forest = createForest(square('pine'));

  it('knows where it is: inside its outline, and how far from its edge', () => {
    expect([forest.minX, forest.maxX, forest.minZ, forest.maxZ]).toEqual([-100, 100, -100, 100]);
    expect(forestContains(forest, 0, 0)).toBe(true);
    expect(forestContains(forest, 99, -99)).toBe(true);
    expect(forestContains(forest, 101, 0)).toBe(false);
    expect(distanceToForestEdge(forest, 0, 0)).toBeCloseTo(100, 9);
    expect(distanceToForestEdge(forest, 90, 0)).toBeCloseTo(10, 9);
    expect(distanceToForestEdge(forest, 110, 0)).toBeCloseTo(10, 9);
  });

  it('grows close along its edge and fewer, taller trees deeper in, every one inside it', () => {
    const trees = plantForest(forest, 7, everywhere, new Occupancy());
    const edge = trees.filter((tree) => !tree.inner);
    const inner = trees.filter((tree) => tree.inner);
    expect(edge.length).toBeGreaterThan(180);
    expect(inner.length).toBeGreaterThan(150);
    for (const tree of trees) {
      expect(forestContains(forest, tree.x, tree.z)).toBe(true);
      expect(distanceToForestEdge(forest, tree.x, tree.z) > FOREST_EDGE_BAND_METERS).toBe(tree.inner);
    }
    // Per square meter, the edge band holds more trees than the middle; the inner ones grow bigger.
    const bandArea = 200 * 200 - (200 - 2 * FOREST_EDGE_BAND_METERS) ** 2;
    const middleArea = (200 - 2 * FOREST_EDGE_BAND_METERS) ** 2;
    expect(edge.length / bandArea).toBeGreaterThan((inner.length / middleArea) * 2);
    const mean = (list: typeof trees): number => list.reduce((sum, tree) => sum + tree.scale, 0) / list.length;
    expect(mean(inner)).toBeGreaterThan(mean(edge) + 0.3);
  });

  it('grows close along only the edge that shows, and as deep in along the rest', () => {
    const all = plantForest(forest, 7, everywhere, new Occupancy());
    // Only the west side (x < 0) is seen from near by.
    const trees = plantForest(forest, 7, everywhere, new Occupancy(), (x) => x < 0);
    for (const tree of trees) {
      const band = distanceToForestEdge(forest, tree.x, tree.z) <= FOREST_EDGE_BAND_METERS;
      expect(tree.inner, `${tree.x}, ${tree.z}`).toBe(!band || tree.x >= 0);
    }
    // The west side's edge as before; the east side's band grows fewer, taller trees, as the middle does.
    const westEdge = (list: typeof trees) => list.filter((tree) => !tree.inner && tree.x < 0);
    expect(westEdge(trees)).toEqual(westEdge(all));
    const eastBand = trees.filter((tree) => tree.x > 0 && distanceToForestEdge(forest, tree.x, tree.z) <= FOREST_EDGE_BAND_METERS);
    const eastBandBefore = all.filter((tree) => tree.x > 0 && distanceToForestEdge(forest, tree.x, tree.z) <= FOREST_EDGE_BAND_METERS);
    expect(eastBand.length).toBeGreaterThan(0);
    expect(eastBand.length).toBeLessThan(eastBandBefore.length / 2);
    expect(eastBand.every((tree) => tree.scale >= 1.3)).toBe(true);
  });

  it('shows its edge where a road passes within reach of it', () => {
    // A road along the forest's south side, 20 m out.
    const south: RoadDefinition = {
      id: 'south_road',
      kind: 'rural',
      widthMeters: 8,
      closed: false,
      controlPoints: [
        [-300, -120],
        [0, -120],
        [300, -120],
      ],
    };
    const shows = forestRoadside(forest, [new RoadPath(south)], 100);
    expect(shows(0, -95)).toBe(true);
    expect(shows(-90, -30)).toBe(true); // 90 m from the road, 86 from its edge.
    expect(shows(0, 95)).toBe(false);
    expect(shows(95, 0)).toBe(false);
    // No road near the forest: no edge shows.
    const far = new RoadPath({
      ...south,
      id: 'far_road',
      controlPoints: [
        [-300, 500],
        [300, 500],
      ],
    });
    expect(forestRoadside(forest, [far], 100)(0, 95)).toBe(false);
  });

  it('keeps its trunks apart from each other and from whatever stands there already', () => {
    const occupancy = new Occupancy();
    occupancy.add(0, 0, 6);
    const trees = plantForest(forest, 7, everywhere, occupancy);
    for (const tree of trees) {
      expect(Math.hypot(tree.x, tree.z)).toBeGreaterThan(6 + FOREST_TRUNK_RADIUS_METERS);
    }
    for (let i = 0; i < trees.length; i += 7) {
      for (let j = i + 1; j < trees.length; j++) {
        const a = trees[i]!;
        const b = trees[j]!;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(FOREST_TRUNK_RADIUS_METERS * 2 + 1 - 1e-9);
      }
    }
    // Each tree is filed as it grows, for whatever is placed after.
    expect(occupancy.isFree(trees[0]!.x, trees[0]!.z, 0.1, 0)).toBe(false);
  });

  it('grows only where it is allowed to', () => {
    const trees = plantForest(forest, 7, (x) => Math.abs(x) > 12, new Occupancy());
    expect(trees.length).toBeGreaterThan(0);
    expect(trees.every((tree) => Math.abs(tree.x) > 12)).toBe(true);
  });

  it('grows pines in a pine forest and broadleaves in a broadleaf one, with a few of the other among them', () => {
    const share = (kind: ForestKind): number => {
      const trees = plantForest(createForest(square(kind)), 7, everywhere, new Occupancy());
      return trees.filter((tree) => tree.kind === 'pine').length / trees.length;
    };
    expect(share('pine')).toBeGreaterThan(0.8);
    expect(share('pine')).toBeLessThan(0.97);
    expect(share('broadleaf')).toBeLessThan(0.2);
    expect(share('broadleaf')).toBeGreaterThan(0.03);
  });

  it('grows a mixed forest in stands: neighbours are mostly of a kind', () => {
    const trees = plantForest(createForest(square('mixed')), 7, everywhere, new Occupancy());
    const pines = trees.filter((tree) => tree.kind === 'pine').length;
    expect(pines / trees.length).toBeGreaterThan(0.2);
    expect(pines / trees.length).toBeLessThan(0.8);
    let same = 0;
    let pairs = 0;
    for (let i = 0; i < trees.length; i++) {
      for (let j = i + 1; j < trees.length; j++) {
        if (Math.hypot(trees[i]!.x - trees[j]!.x, trees[i]!.z - trees[j]!.z) < 12) {
          pairs++;
          same += trees[i]!.kind === trees[j]!.kind ? 1 : 0;
        }
      }
    }
    expect(same / pairs).toBeGreaterThan(0.7);
  });

  it('is planted the same from the same seed, differently from another, and differently from another forest', () => {
    const plant = (seed: number, id?: string) => plantForest(createForest(square('mixed', id)), seed, everywhere, new Occupancy());
    expect(plant(7)).toEqual(plant(7));
    expect(plant(8)).not.toEqual(plant(7));
    expect(plant(7, 'other_forest')).not.toEqual(plant(7));
  });
});
