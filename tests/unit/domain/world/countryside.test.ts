import { describe, expect, it } from 'vitest';
import type { FieldCrop, Point2, RectangleDefinition, RoadKind } from '../../../../src/data/definitions/MapDefinition';
import { rectangleContains } from '../../../../src/data/definitions/MapDefinition';
import {
  GATE_WIDTH_METERS,
  Occupancy,
  placeFieldEdges,
  placeGrazers,
  placePowerLines,
  placeRocks,
  plantTrees,
  POLE_RADIUS_METERS,
  POLE_SPACING_METERS,
  type SceneryGround,
} from '../../../../src/domain/world/countryside';
import { RoadPath } from '../../../../src/domain/world/RoadPath';

function road(id: string, kind: RoadKind, controlPoints: Point2[], widthMeters = 8): RoadPath {
  return new RoadPath({ id, kind, widthMeters, closed: false, controlPoints });
}

type Field = { readonly area: RectangleDefinition; readonly crop: FieldCrop };

/** Open country: clear everywhere but on the roads (and a meter either side), in the fields and where `blocked` says. */
function ground(roads: RoadPath[], fields: Field[] = [], blocked: (x: number, z: number) => boolean = () => false): SceneryGround {
  return {
    roads,
    fields,
    isClear: (x, z) =>
      !blocked(x, z) &&
      roads.every((candidate) => candidate.distanceTo(x, z) > candidate.widthMeters / 2 + 1) &&
      fields.every(({ area }) => !rectangleContains(area, x, z)),
    nearRoad: (x, z, clearanceMeters) => edgeDistance(roads, x, z) < clearanceMeters,
  };
}

/** A field beside the road along z = 0: 100 m along it, 40 m deep, its near side 20 m off the road's centreline. */
function fieldBeside(crop: FieldCrop, x = 0): Field {
  return { area: { x, z: 40, headingDegrees: 90, lengthMeters: 100, widthMeters: 40 }, crop };
}

/** The distance from (x, z) to the nearest road's edge. */
function edgeDistance(roads: readonly RoadPath[], x: number, z: number): number {
  return Math.min(...roads.map((candidate) => candidate.distanceTo(x, z) - candidate.widthMeters / 2));
}

/** Whether no two of `circles` overlap. */
function apart(circles: readonly { x: number; z: number; radius: number }[]): boolean {
  return circles.every((a, i) => circles.every((b, j) => i === j || Math.hypot(a.x - b.x, a.z - b.z) >= a.radius + b.radius));
}

describe('Occupancy', () => {
  it('keeps what is filed free of new things, the gap included, across its grid cells', () => {
    const occupancy = new Occupancy();
    occupancy.add(15.9, 0, 1);

    expect(occupancy.isFree(15.9, 0, 0.1, 0)).toBe(false);
    // Just across a cell's edge from it, and further than the gap.
    expect(occupancy.isFree(17.5, 0, 0.4, 0.5)).toBe(false);
    expect(occupancy.isFree(18.5, 0, 0.4, 0.5)).toBe(true);
    expect(occupancy.isFree(-40, 12, 3, 3)).toBe(true);
  });
});

describe('placePowerLines', () => {
  const east = road('east', 'rural', [
    [-500, 0],
    [500, 0],
  ]);
  const north = road('north', 'rural', [
    [-500, 300],
    [500, 300],
  ]);

  it('stands a pole every POLE_SPACING_METERS along a country road, past its verge, wired in one line', () => {
    const occupancy = new Occupancy();
    const lines = placePowerLines(ground([east]), occupancy);

    expect(lines).toHaveLength(1);
    const poles = lines[0]!.poles;
    expect(poles).toHaveLength(Math.ceil((1000 - POLE_SPACING_METERS / 2) / POLE_SPACING_METERS));
    poles.forEach((pole, index) => {
      // Right of the road's direction (+x) is +z.
      expect(pole.z).toBeCloseTo(4 + 6.5, 6);
      expect(pole.x).toBeCloseTo(-500 + POLE_SPACING_METERS / 2 + index * POLE_SPACING_METERS, 6);
      expect(pole.heading).toBeCloseTo(Math.PI / 2, 9);
      expect(pole.radius).toBe(POLE_RADIUS_METERS);
      expect(occupancy.isFree(pole.x, pole.z, 0.1, 0)).toBe(false);
    });
  });

  it('runs along the right of one country road and the left of the next, and never along streets or highways', () => {
    const lines = placePowerLines(
      ground([
        east,
        road('street', 'street', [
          [-500, -200],
          [500, -200],
        ]),
        road('highway', 'highway', [
          [-500, -400],
          [500, -400],
        ], 14),
        north,
      ]),
      new Occupancy(),
    );

    expect(lines).toHaveLength(2);
    expect(lines[0]!.poles.every((pole) => pole.z > 0 && pole.z < 20)).toBe(true);
    expect(lines[1]!.poles.every((pole) => pole.z < 300 && pole.z > 280)).toBe(true);
  });

  it('breaks the line where a pole cannot stand, and leaves out a pole alone', () => {
    // Poles would stand at x = -479 + 42k. Blocked at -311 (one pole's place), and at -59 and 25, leaving -17 between.
    const blocked = (x: number): boolean => Math.abs(x + 311) < 5 || (x > -60 && x < -20) || (x > 5 && x < 40);
    const occupancy = new Occupancy();
    const lines = placePowerLines(ground([east], [], blocked), occupancy);

    const poles = lines.flatMap((line) => line.poles);
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => line.poles.length >= 2)).toBe(true);
    expect(poles.some((pole) => blocked(pole.x))).toBe(false);
    // The pole that would stand alone at x = -17 is neither in a line nor filed as solid.
    const alone = -500 + POLE_SPACING_METERS / 2 + 11 * POLE_SPACING_METERS;
    expect(alone).toBeCloseTo(-17, 6);
    expect(poles.some((pole) => Math.abs(pole.x - alone) < 1)).toBe(false);
    expect(occupancy.isFree(alone, 10.5, 0.1, 0)).toBe(true);
    // No wire spans a gap: neighbours in a line are one spacing apart.
    for (const line of lines) {
      for (let i = 1; i < line.poles.length; i++) {
        expect(line.poles[i]!.x - line.poles[i - 1]!.x).toBeCloseTo(POLE_SPACING_METERS, 6);
      }
    }
  });

  it('keeps off what stands there already', () => {
    const occupancy = new Occupancy();
    occupancy.add(-500 + POLE_SPACING_METERS / 2 + 5 * POLE_SPACING_METERS, 10.5, 0.5);

    const poles = placePowerLines(ground([east]), occupancy).flatMap((line) => line.poles);

    expect(poles).toHaveLength(Math.ceil((1000 - POLE_SPACING_METERS / 2) / POLE_SPACING_METERS) - 1);
  });
});

describe('placeFieldEdges', () => {
  const east = road('east', 'rural', [
    [-500, 0],
    [500, 0],
  ]);

  it("runs along a field's side that faces its road, with a gate in the middle", () => {
    const edges = placeFieldEdges(ground([east], [fieldBeside('wheat')]));

    expect(edges).toHaveLength(2);
    const [left, right] = edges;
    for (const edge of edges) {
      expect(edge.from[1]).toBeCloseTo(20, 6);
      expect(edge.to[1]).toBeCloseTo(20, 6);
    }
    const spans = [left!, right!].map((edge) => [Math.min(edge.from[0], edge.to[0]), Math.max(edge.from[0], edge.to[0])]);
    expect(spans.sort((a, b) => a[0]! - b[0]!)).toEqual([
      [expect.closeTo(-50, 6), expect.closeTo(-GATE_WIDTH_METERS / 2, 6)],
      [expect.closeTo(GATE_WIDTH_METERS / 2, 6), expect.closeTo(50, 6)],
    ]);
  });

  it('fences the grain and walls the rest', () => {
    const kinds = (crop: FieldCrop): string[] => placeFieldEdges(ground([east], [fieldBeside(crop)])).map((edge) => edge.kind);

    expect(kinds('wheat')).toEqual(['fence', 'fence']);
    expect(kinds('stubble')).toEqual(['fence', 'fence']);
    expect(kinds('green')).toEqual(['wall', 'wall']);
    expect(kinds('ploughed')).toEqual(['wall', 'wall']);
  });

  it('finds the road on whichever side it is', () => {
    const across = road('across', 'rural', [
      [-500, 90],
      [500, 90],
    ]);

    const edges = placeFieldEdges(ground([across], [fieldBeside('green')]));

    // The field spans z 20..60: its far side from z = 0, the near one to this road.
    expect(edges.every((edge) => Math.abs(edge.from[1] - 60) < 1e-6 && Math.abs(edge.to[1] - 60) < 1e-6)).toBe(true);
  });
});

describe('placeRocks', () => {
  const roads = [
    road('east', 'rural', [
      [-900, 0],
      [900, 0],
    ]),
  ];

  it('lies boulders in clusters, clear of the roads, the fields and one another, the same for the same seed', () => {
    const field = fieldBeside('wheat');
    const rocks = placeRocks(ground(roads, [field]), new Occupancy(), 1000, 7);

    expect(rocks.length).toBeGreaterThan(40);
    expect(apart(rocks)).toBe(true);
    for (const rock of rocks) {
      expect(edgeDistance(roads, rock.x, rock.z)).toBeGreaterThan(10);
      expect(rectangleContains(field.area, rock.x, rock.z)).toBe(false);
      expect(Math.abs(rock.x)).toBeLessThan(1000);
      expect(rock.radius).toBeCloseTo(rock.size * 0.45, 9);
      expect(rock.size).toBeGreaterThanOrEqual(0.5);
      expect(rock.size).toBeLessThanOrEqual(2.6);
    }
    expect(placeRocks(ground(roads, [field]), new Occupancy(), 1000, 7)).toEqual(rocks);
    expect(placeRocks(ground(roads, [field]), new Occupancy(), 1000, 8)).not.toEqual(rocks);
  });

  it('moves no other boulder when one cannot lie', () => {
    const all = placeRocks(ground(roads), new Occupancy(), 1000, 7);
    const first = all[0]!;
    const occupancy = new Occupancy();
    occupancy.add(first.x, first.z, 0.01);

    const without = placeRocks(ground(roads), occupancy, 1000, 7);

    // Only the first and anything touching it are gone; the rest lie where they lay.
    expect(without.length).toBeGreaterThanOrEqual(all.length - 3);
    expect(without.at(-1)).toEqual(all.at(-1));
  });
});

describe('placeGrazers', () => {
  const roads = [
    road('east', 'rural', [
      [-900, 0],
      [900, 0],
    ]),
    road('north', 'rural', [
      [-900, 500],
      [900, 500],
    ]),
  ];

  it('puts flocks of sheep and herds of cows on the pasture beside the country roads, each clear of the rest', () => {
    const occupancy = new Occupancy();
    const grazers = placeGrazers(ground(roads), occupancy, 3);

    const sheep = grazers.filter((grazer) => grazer.kind === 'sheep');
    const cows = grazers.filter((grazer) => grazer.kind === 'cow');
    expect(sheep.length).toBeGreaterThan(40);
    expect(cows.length).toBeGreaterThan(8);
    expect(apart(grazers)).toBe(true);
    for (const grazer of grazers) {
      const distance = edgeDistance(roads, grazer.x, grazer.z);
      expect(distance).toBeGreaterThan(12);
      expect(distance).toBeLessThan(90);
      expect(occupancy.isFree(grazer.x, grazer.z, 0.1, 0)).toBe(false);
    }
    expect(placeGrazers(ground(roads), new Occupancy(), 3)).toEqual(grazers);
  });

  it('needs a country road', () => {
    const streets = [
      road('street', 'street', [
        [-100, 0],
        [100, 0],
      ]),
    ];

    expect(placeGrazers(ground(streets), new Occupancy(), 3)).toEqual([]);
  });
});

describe('plantTrees', () => {
  const east = road('east', 'rural', [
    [-600, 0],
    [600, 0],
  ]);
  const fields = [0, 1, 2, 3].map((index) => fieldBeside('wheat', -450 + index * 300));

  it('plants a windbreak of poplars behind every third field, olive groves by the first country road and cypresses where it reaches a town', () => {
    const occupancy = new Occupancy();
    const trees = plantTrees(ground([east], fields), occupancy, 5);

    const poplars = trees.filter((tree) => tree.species === 'poplar');
    const olives = trees.filter((tree) => tree.species === 'olive');
    const cypresses = trees.filter((tree) => tree.species === 'cypress');
    // Fields 0 and 3: along their far side (z = 60), 4 m behind.
    expect(poplars.length).toBeGreaterThan(20);
    for (const poplar of poplars) {
      expect(poplar.z).toBeCloseTo(64, 6);
      expect([fields[0], fields[3]].some((field) => Math.abs(poplar.x - field!.area.x) <= 50)).toBe(true);
    }
    expect(olives.length).toBeGreaterThan(40);
    // Cypresses line both sides of the road's first and last stretches.
    expect(cypresses.length).toBeGreaterThan(40);
    for (const cypress of cypresses) {
      expect(Math.abs(cypress.z)).toBeCloseTo(4 + 5.5, 6);
      expect(Math.abs(cypress.x)).toBeGreaterThan(600 - 191);
    }
    expect(apart(trees)).toBe(true);
    for (const tree of trees) {
      expect(occupancy.isFree(tree.x, tree.z, 0.05, 0)).toBe(false);
      expect(tree.scale).toBeGreaterThan(0.75);
      expect(tree.scale).toBeLessThan(1.25);
    }
    expect(plantTrees(ground([east], fields), new Occupancy(), 5)).toEqual(trees);
  });

  it('plants nothing where nothing may stand', () => {
    expect(plantTrees(ground([east], fields, () => true), new Occupancy(), 5)).toEqual([]);
  });
});
