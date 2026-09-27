import { describe, expect, it } from 'vitest';
import type { Point2, RoadKind } from '../../../../src/data/definitions/MapDefinition';
import { Occupancy } from '../../../../src/domain/world/countryside';
import { RoadNetwork } from '../../../../src/domain/world/RoadNetwork';
import { RoadPath } from '../../../../src/domain/world/RoadPath';
import {
  DIRECTION_BOARD_LEG_RADIUS_METERS,
  directionBoardLegs,
  placeDirectionBoards,
  placeRoadSigns,
  type RoadSign,
  type SignGround,
  type TownGate,
} from '../../../../src/domain/world/roadSigns';

function road(id: string, kind: RoadKind, controlPoints: Point2[], widthMeters = 8): RoadPath {
  return new RoadPath({ id, kind, widthMeters, closed: false, controlPoints });
}

/** Open country round `roads`: a sign may stand anywhere a meter off every road, but where `blocked` says. */
function ground(
  roads: RoadPath[],
  options: { gates?: TownGate[]; villages?: { id: string; x: number; z: number }[]; blocked?: (x: number, z: number) => boolean } = {},
): SignGround {
  const blocked = options.blocked ?? (() => false);
  return {
    roads,
    network: new RoadNetwork(roads),
    townGates: options.gates ?? [],
    villages: options.villages ?? [],
    isClear: (x, z) => !blocked(x, z) && roads.every((candidate) => candidate.distanceTo(x, z) > candidate.widthMeters / 2 + 1),
  };
}

/**
 * A road heading +z to the origin, bending left (toward +x) round a
 * circle of `radius`, then on along +x: 400 m each side, its control
 * points evenly apart (a curve through them does not overshoot).
 */
function leftBend(radius: number, kind: RoadKind = 'rural'): RoadPath {
  const step = 15;
  const points: Point2[] = [];
  for (let z = -400; z < 0; z += step) {
    points.push([0, z]);
  }
  const arcSteps = Math.max(2, Math.round((radius * Math.PI) / 2 / step));
  for (let i = 0; i <= arcSteps; i++) {
    const angle = (i / arcSteps) * (Math.PI / 2);
    points.push([radius - radius * Math.cos(angle), radius * Math.sin(angle)]);
  }
  for (let x = radius + step; x <= radius + 400; x += step) {
    points.push([x, radius]);
  }
  return road('bend', kind, points);
}

/** The heading of a face looking along (dx, dz). */
const facing = (dx: number, dz: number): number => Math.atan2(dx, dz);

/** How far apart two headings are, the short way round (radians). */
function turnBetween(a: number, b: number): number {
  const turn = a - b;
  return Math.abs(turn - Math.round(turn / (2 * Math.PI)) * 2 * Math.PI);
}

function kinds(signs: readonly RoadSign[]): string[] {
  return signs.map((sign) => sign.kind).sort();
}

describe('placeRoadSigns: bends', () => {
  it('warns of a sharp bend both ways, on the right of the traffic heading into it and facing it', () => {
    const signs = placeRoadSigns(ground([leftBend(60)]), new Occupancy());

    // Heading +z into it, the bend turns left: the sign stands on that traffic's right (-x), well before it, facing it.
    const intoLeft = signs.filter((sign) => sign.kind === 'bendLeft');
    expect(intoLeft).toHaveLength(1);
    expect(intoLeft[0]!.x).toBeCloseTo(-(4 + 2.4), 1);
    expect(intoLeft[0]!.z).toBeLessThan(-40);
    expect(intoLeft[0]!.z).toBeGreaterThan(-110);
    expect(turnBetween(intoLeft[0]!.heading, facing(0, -1))).toBeLessThan(1e-6);
    // Heading -x into it the other way it turns right: that traffic's right is -z of the road (z = 60).
    const intoRight = signs.filter((sign) => sign.kind === 'bendRight');
    expect(intoRight).toHaveLength(1);
    expect(intoRight[0]!.z).toBeCloseTo(60 - (4 + 2.4), 1);
    expect(intoRight[0]!.x).toBeGreaterThan(60 + 40);
    expect(turnBetween(intoRight[0]!.heading, facing(1, 0))).toBeLessThan(1e-6);
  });

  it('puts chevrons round the outside of a sharp bend, facing the traffic it turns left for', () => {
    const signs = placeRoadSigns(ground([leftBend(60)]), new Occupancy());

    const chevrons = signs.filter((sign) => sign.kind === 'chevron');
    expect(chevrons.length).toBeGreaterThanOrEqual(3);
    expect(chevrons.length).toBeLessThanOrEqual(7);
    for (const chevron of chevrons) {
      // Outside the circle the road bends round (its middle at (60, 0)), just past the road's edge.
      expect(Math.hypot(chevron.x - 60, chevron.z)).toBeGreaterThan(60 + 4 + 1);
      expect(Math.hypot(chevron.x - 60, chevron.z)).toBeLessThan(60 + 4 + 4);
      // Its face looks back against the traffic heading round to the left: toward the start of the road.
      const along = Math.atan2(chevron.z, 60 - chevron.x);
      expect(turnBetween(chevron.heading, facing(-Math.sin(along), -Math.cos(along)))).toBeLessThan(0.35);
    }
  });

  it('leaves a gentle bend unsigned, and puts no warnings (only chevrons round the sharpest) on a lane', () => {
    expect(placeRoadSigns(ground([leftBend(400)]), new Occupancy())).toEqual([]);

    expect(kinds(placeRoadSigns(ground([leftBend(60, 'lane')]), new Occupancy()))).toEqual([]);
    const sharp = placeRoadSigns(ground([leftBend(30, 'lane')]), new Occupancy());
    expect(sharp.length).toBeGreaterThanOrEqual(3);
    expect(sharp.every((sign) => sign.kind === 'chevron')).toBe(true);
  });
});

/** A country road along z = 0 through a junction at the origin, and `minor` roads meeting it there. */
function junction(minor: RoadPath[]): RoadPath[] {
  return [
    road('major', 'rural', [
      [-600, 0],
      [0, 0],
      [600, 0],
    ]),
    ...minor,
  ];
}

describe('placeRoadSigns: junctions', () => {
  it('warns of a country road joining on one side, and has its traffic stop before the road it meets', () => {
    const roads = junction([
      road('north', 'rural', [
        [0, 0],
        [0, 500],
      ]),
    ]);

    const signs = placeRoadSigns(ground(roads), new Occupancy());

    // Heading +x the road joins on the right (+z), heading -x on the left.
    const right = signs.filter((sign) => sign.kind === 'sideRoadRight');
    const left = signs.filter((sign) => sign.kind === 'sideRoadLeft');
    expect(right).toHaveLength(1);
    expect(left).toHaveLength(1);
    expect(right[0]!.x).toBeLessThan(-30);
    expect(right[0]!.z).toBeCloseTo(4 + 2.4, 1);
    expect(left[0]!.x).toBeGreaterThan(30);
    expect(left[0]!.z).toBeCloseTo(-(4 + 2.4), 1);
    // Stop: on the joining road, a few meters back from the major's edge, on the right of the traffic arriving (heading -z).
    const stop = signs.filter((sign) => sign.kind === 'stop');
    expect(stop).toHaveLength(1);
    expect(stop[0]!.x).toBeCloseTo(4 + 2.4, 1);
    expect(stop[0]!.z).toBeCloseTo(4 + 3.5, 0);
    expect(turnBetween(stop[0]!.heading, facing(0, 1))).toBeLessThan(1e-6);
  });

  it('gives way where a farm lane comes out, without a warning on the road; warns of lanes crossing it', () => {
    const lane = road('farm', 'lane', [
      [0, 0],
      [0, 400],
    ], 5.5);
    expect(kinds(placeRoadSigns(ground(junction([lane])), new Occupancy()))).toEqual(['giveWay']);

    const across = road('farm_south', 'lane', [
      [0, 0],
      [0, -400],
    ], 5.5);
    expect(kinds(placeRoadSigns(ground(junction([lane, across])), new Occupancy()))).toEqual([
      'crossroads',
      'crossroads',
      'giveWay',
      'giveWay',
    ]);
  });

  it('signs nothing where a town street meets the road', () => {
    const street = road('high_street', 'street', [
      [0, 0],
      [0, 400],
    ], 10);

    expect(placeRoadSigns(ground(junction([street])), new Occupancy())).toEqual([]);
  });

  it('moves a warning nearer its junction where the ground is taken, and keeps clear of what stands', () => {
    const roads = junction([
      road('north', 'rural', [
        [0, 0],
        [0, 500],
      ]),
    ]);
    // Something at 75 m before the junction heading +x, and the ground taken at 62 m.
    const occupancy = new Occupancy();
    occupancy.add(-75, 4 + 2.4, 0.5);
    const blocked = (x: number, z: number): boolean => Math.abs(x + 62) < 2 && z > 0;

    const signs = placeRoadSigns(ground(roads, { blocked }), occupancy);

    const right = signs.find((sign) => sign.kind === 'sideRoadRight')!;
    expect(right.x).toBeCloseTo(-50, 0);
    expect(occupancy.isFree(right.x, right.z, 0.05, 0)).toBe(false);
  });
});

describe('placeDirectionBoards', () => {
  // Town A at the west end of a country road, town B at its east end, a village up a road north from its middle.
  const roads = junction([
    road('village_road', 'rural', [
      [0, 0],
      [0, 800],
    ]),
  ]);
  const gates: TownGate[] = [
    { cityId: 'town_a', roadIndex: 0, distanceMeters: 100, direction: 'backward' },
    { cityId: 'town_b', roadIndex: 0, distanceMeters: 1100, direction: 'forward' },
  ];
  const villages = [{ id: 'hamlet', x: 0, z: 800 }];

  it('names where each way on leads and how far, before the junction, on each road into it', () => {
    const boards = placeDirectionBoards(ground(roads, { gates, villages }), new Occupancy());

    const atJunction = boards.filter((board) => board.rows.every((row) => row.arrow !== null));
    expect(atJunction).toHaveLength(3);
    // Heading +x from A: B straight on, the village to the right (north); A is behind, so not named.
    const fromWest = atJunction.find((board) => board.x < -40)!;
    expect(fromWest.rows).toEqual([
      { placeKind: 'city', placeId: 'town_b', arrow: 'ahead', kilometers: 1 },
      { placeKind: 'village', placeId: 'hamlet', arrow: 'right', kilometers: 1 },
    ]);
    expect(fromWest.z).toBeCloseTo(4 + 3.4, 1);
    expect(turnBetween(fromWest.heading, facing(-1, 0))).toBeLessThan(1e-6);
    expect(fromWest.tone).toBe('blue');
    // Heading -z from the village, +x is on the right: A to the left, B to the right.
    const fromNorth = atJunction.find((board) => board.z > 40)!;
    expect(fromNorth.rows.map((row) => [row.placeId, row.arrow])).toEqual([
      ['town_a', 'left'],
      ['town_b', 'right'],
    ]);
  });

  it('puts a board just out of each town with what lies ahead: the village near, then the towns', () => {
    const boards = placeDirectionBoards(ground(roads, { gates, villages }), new Occupancy());

    const outOfTown = boards.filter((board) => board.rows.every((row) => row.arrow === null));
    expect(outOfTown).toHaveLength(2);
    const leavingA = outOfTown.find((board) => board.x < 0)!;
    // 160 m past A's name board, on the right of the traffic heading +x.
    expect(leavingA.x).toBeCloseTo(-600 + 100 + 160, 0);
    expect(leavingA.z).toBeCloseTo(4 + 3.4, 1);
    expect(leavingA.rows).toEqual([
      { placeKind: 'village', placeId: 'hamlet', arrow: null, kilometers: 1 },
      { placeKind: 'city', placeId: 'town_b', arrow: null, kilometers: 1 },
    ]);
  });

  it('stands its legs across the board, clear of the road, and files them as solid', () => {
    const occupancy = new Occupancy();
    const boards = placeDirectionBoards(ground(roads, { gates, villages }), occupancy);

    expect(boards.length).toBeGreaterThan(0);
    for (const board of boards) {
      const legs = directionBoardLegs(board);
      expect(legs).toHaveLength(2);
      for (const leg of legs) {
        expect(leg.radius).toBe(DIRECTION_BOARD_LEG_RADIUS_METERS);
        expect(roads.every((candidate) => candidate.distanceTo(leg.x, leg.z) > candidate.widthMeters / 2 + 1)).toBe(true);
        expect(occupancy.isFree(leg.x, leg.z, 0.01, 0)).toBe(false);
      }
    }
  });

  it('names nothing without towns or villages', () => {
    expect(placeDirectionBoards(ground(roads), new Occupancy())).toEqual([]);
  });
});
