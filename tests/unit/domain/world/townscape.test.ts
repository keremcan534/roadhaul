import { describe, expect, it } from 'vitest';
import type { Point2, RoadKind } from '../../../../src/data/definitions/MapDefinition';
import { Occupancy } from '../../../../src/domain/world/countryside';
import { RoadPath } from '../../../../src/domain/world/RoadPath';
import {
  BILLBOARD_ADS,
  BILLBOARD_LEG_SPACING_METERS,
  billboardLegs,
  OUTLINE_ROW,
  PavementGrid,
  placeBillboards,
  placeSidewalks,
  placeSpeedSigns,
  placeStreetFurniture,
  SIDEWALK_WIDTH_METERS,
  sidewalkOutline,
  TOWN_SPEED_LIMIT_KMH,
  type Sidewalk,
  type TownGround,
} from '../../../../src/domain/world/townscape';

function road(id: string, kind: RoadKind, controlPoints: Point2[], widthMeters = 10): RoadPath {
  return new RoadPath({ id, kind, widthMeters, closed: false, controlPoints });
}

/** A town: a pavement may run anywhere off the roads (with a 0.9 m margin) but where `blocked` says. */
function town(roads: RoadPath[], blocked: (x: number, z: number) => boolean = () => false): TownGround {
  const offRoads = (x: number, z: number, margin: number): boolean =>
    roads.every((candidate) => candidate.distanceTo(x, z) > candidate.widthMeters / 2 + margin);
  return {
    roads,
    isClearForWalk: (x, z) => !blocked(x, z) && offRoads(x, z, 0.9),
    isClear: (x, z) => !blocked(x, z) && offRoads(x, z, 1),
  };
}

const high = road('high', 'street', [
  [-100, 0],
  [100, 0],
]);

describe('placeSidewalks', () => {
  it('lays a pavement along both sides of a street, end to end', () => {
    const sidewalks = placeSidewalks(town([high]));

    expect(sidewalks).toEqual([
      { roadIndex: 0, side: 1, fromMeters: 0, toMeters: expect.closeTo(200, 6) },
      { roadIndex: 0, side: -1, fromMeters: 0, toMeters: expect.closeTo(200, 6) },
    ]);
  });

  it('breaks it where a road crosses or a yard opens off it, and leaves out the short pieces', () => {
    const cross = road('cross', 'street', [
      [0, -100],
      [0, 100],
    ]);
    // A yard on the right of the high street (z > 0) from x = 40 to 90, leaving 5 m to the street's end.
    const yard = (x: number, z: number): boolean => z > 0 && x > 40 && x < 95;

    const sidewalks = placeSidewalks(town([high, cross], yard)).filter((sidewalk) => sidewalk.roadIndex === 0);

    const right = sidewalks.filter((sidewalk) => sidewalk.side === 1);
    const left = sidewalks.filter((sidewalk) => sidewalk.side === -1);
    // Right: from the start to the crossing, then to the yard; the 5 m past the yard is too short.
    expect(right).toHaveLength(2);
    expect(right[0]!.toMeters).toBeLessThan(100 - 5);
    expect(right[1]!.fromMeters).toBeGreaterThan(100 + 5);
    expect(right[1]!.toMeters).toBeLessThan(140);
    // Left: either side of the crossing.
    expect(left).toHaveLength(2);
    for (const sidewalk of sidewalks) {
      expect(sidewalk.toMeters - sidewalk.fromMeters).toBeGreaterThanOrEqual(8);
    }
  });

  it('lays none along country roads, highways or the ring road', () => {
    const roads = (['rural', 'highway', 'ringRoad'] as const).map((kind, index) =>
      road(kind, kind, [
        [-100, index * 100],
        [100, index * 100],
      ]),
    );

    expect(placeSidewalks(town(roads))).toEqual([]);
  });
});

describe('sidewalkOutline', () => {
  it("follows the kerb and the pavement's back in rows at most 2 m apart", () => {
    const sidewalk: Sidewalk = { roadIndex: 0, side: 1, fromMeters: 20, toMeters: 45 };

    const rows = sidewalkOutline(high, sidewalk);

    const count = rows.length / OUTLINE_ROW;
    expect(count).toBe(Math.ceil(25 / 2) + 1);
    for (let row = 0; row < count; row++) {
      const [along, kerbX, kerbZ, backX, backZ] = rows.slice(row * OUTLINE_ROW, (row + 1) * OUTLINE_ROW);
      expect(along).toBeCloseTo(20 + (25 * row) / (count - 1), 6);
      expect(kerbX).toBeCloseTo(-100 + along!, 6);
      expect(backX).toBeCloseTo(kerbX!, 6);
      // Right of the road's direction (+x) is +z.
      expect(kerbZ).toBeCloseTo(5, 6);
      expect(backZ).toBeCloseTo(5 + SIDEWALK_WIDTH_METERS, 6);
    }
    const left = sidewalkOutline(high, { ...sidewalk, side: -1 });
    expect(left[2]).toBeCloseTo(-5, 6);
    expect(left[4]).toBeCloseTo(-5 - SIDEWALK_WIDTH_METERS, 6);
  });
});

describe('PavementGrid', () => {
  it('knows the paved ground beside a street from the road and the grass', () => {
    const pavements = new PavementGrid([high], [{ roadIndex: 0, side: 1, fromMeters: 20, toMeters: 150 }]);

    expect(pavements.contains(0, 6)).toBe(true);
    expect(pavements.contains(-79.5, 7.5)).toBe(true);
    expect(pavements.contains(49.9, 5.1)).toBe(true);
    // The road, past the pavement's back, the other side of the street, beyond its ends.
    expect(pavements.contains(0, 4.9)).toBe(false);
    expect(pavements.contains(0, 5 + SIDEWALK_WIDTH_METERS + 0.1)).toBe(false);
    expect(pavements.contains(0, -6)).toBe(false);
    expect(pavements.contains(-81, 6)).toBe(false);
    expect(pavements.contains(51, 6)).toBe(false);
    expect(new PavementGrid([high], []).contains(0, 6)).toBe(false);
  });

  it('follows a bend', () => {
    const bend = road('bend', 'street', [
      [-100, 0],
      [0, 0],
      [60, 60],
      [60, 160],
    ]);
    const sidewalks = placeSidewalks(town([bend]));
    const pavements = new PavementGrid([bend], sidewalks);
    const rows = sidewalkOutline(bend, sidewalks[0]!);

    for (let at = 0; at < rows.length; at += OUTLINE_ROW * 7) {
      // Halfway between the kerb and the back, anywhere along: on it.
      expect(pavements.contains((rows[at + 1]! + rows[at + 3]!) / 2, (rows[at + 2]! + rows[at + 4]!) / 2)).toBe(true);
    }
  });
});

describe('placeStreetFurniture', () => {
  it("stands a bus shelter at the back of each street's longest pavement on the right, and benches and bins by turns", () => {
    const sidewalks = placeSidewalks(town([high]));
    const occupancy = new Occupancy();

    const furniture = placeStreetFurniture(town([high]), sidewalks, occupancy);

    const shelters = furniture.filter((item) => item.kind === 'busStop');
    expect(shelters).toHaveLength(1);
    expect(shelters[0]!.x).toBeCloseTo(0, 6);
    expect(shelters[0]!.z).toBeCloseTo(5 + SIDEWALK_WIDTH_METERS + 1.1, 6);
    const benchesAndBins = furniture.filter((item) => item.kind !== 'busStop');
    expect(benchesAndBins.length).toBeGreaterThanOrEqual(8);
    // Along each side: a bench, then a bin, and so on, 38 m apart, near the pavement's back.
    const right = benchesAndBins.filter((item) => item.z > 0).sort((a, b) => a.x - b.x);
    expect(right.map((item) => item.kind).slice(0, 2)).toEqual(['bench', 'bin']);
    for (const item of benchesAndBins) {
      expect(Math.abs(item.z)).toBeCloseTo(5 + SIDEWALK_WIDTH_METERS - 0.55, 6);
      // Facing the road: toward the centreline.
      expect(Math.cos(item.heading) * Math.sign(item.z)).toBeCloseTo(-1, 6);
      expect(occupancy.isFree(item.x, item.z, 0.05, 0)).toBe(false);
    }
    const items = [...furniture];
    expect(items.every((a, i) => items.every((b, j) => i === j || Math.hypot(a.x - b.x, a.z - b.z) >= a.radius + b.radius))).toBe(true);
  });

  it('keeps clear of what stands on the pavement already', () => {
    const sidewalks = placeSidewalks(town([high]));
    const free = placeStreetFurniture(town([high]), sidewalks, new Occupancy());
    const lamp = free.find((item) => item.kind === 'bench')!;
    const occupancy = new Occupancy();
    occupancy.add(lamp.x, lamp.z, 0.2);

    const furniture = placeStreetFurniture(town([high]), sidewalks, occupancy);

    expect(furniture).toHaveLength(free.length - 1);
    expect(furniture.some((item) => Math.hypot(item.x - lamp.x, item.z - lamp.z) < 1)).toBe(false);
  });
});

describe('placeBillboards', () => {
  const rural = road(
    'rural',
    'rural',
    [
      [-600, 0],
      [600, 0],
    ],
    8,
  );

  it('stands one on the right of the traffic heading into each town, turned a little toward it, posters by turns', () => {
    const occupancy = new Occupancy();
    const billboards = placeBillboards(town([high, rural]), occupancy);

    expect(billboards).toHaveLength(2);
    const [atStart, atEnd] = billboards;
    // Near the start the traffic heading into town drives toward -x: its right is -z; its face looks back toward +x.
    expect(atStart!.x).toBeCloseTo(-600 + 260, 6);
    expect(atStart!.z).toBeCloseTo(-(4 + 11), 6);
    expect(atStart!.heading).toBeCloseTo(Math.PI / 2 - 0.35, 6);
    expect(atEnd!.x).toBeCloseTo(600 - 260, 6);
    expect(atEnd!.z).toBeCloseTo(4 + 11, 6);
    expect(atEnd!.heading).toBeCloseTo(-Math.PI / 2 - 0.35, 6);
    expect(billboards.map((billboard) => billboard.ad)).toEqual([0, 1]);
    for (const leg of billboards.flatMap(billboardLegs)) {
      expect(occupancy.isFree(leg.x, leg.z, 0.05, 0)).toBe(false);
    }
  });

  it('moves along the road to where it can stand, and hands the posters round in turn', () => {
    const roads = [0, 1, 2].map((index) =>
      road(`rural${index}`, 'rural', [
        [-600, index * 200],
        [600, index * 200],
      ], 8),
    );
    // Something where the first one would stand.
    const blocked = (x: number, z: number): boolean => Math.abs(x + 340) < 6 && Math.abs(z + 15) < 6;

    const billboards = placeBillboards(town(roads, blocked), new Occupancy());

    expect(billboards).toHaveLength(6);
    expect(billboards[0]!.x).toBeCloseTo(-600 + 260 + 30, 6);
    expect(billboards.map((billboard) => billboard.ad)).toEqual([0, 1, 2, 3, 0, 1].map((ad) => ad % BILLBOARD_ADS));
  });

  it('stands its two legs either side of its middle, across its face', () => {
    const legs = billboardLegs({ x: 10, z: 20, heading: Math.PI / 2, ad: 0 });

    expect(legs).toHaveLength(2);
    expect(legs[0]!.x).toBeCloseTo(10, 9);
    expect(legs[1]!.x).toBeCloseTo(10, 9);
    expect(Math.abs(legs[0]!.z - legs[1]!.z)).toBeCloseTo(BILLBOARD_LEG_SPACING_METERS, 9);
    expect((legs[0]!.z + legs[1]!.z) / 2).toBeCloseTo(20, 9);
  });
});

describe('placeSpeedSigns', () => {
  const rural = road(
    'rural',
    'rural',
    [
      [-600, 0],
      [600, 0],
    ],
    8,
  );
  const highway = road(
    'highway',
    'highway',
    [
      [-600, 300],
      [600, 300],
    ],
    14,
  );

  it("puts the town's limit past its name board for the traffic coming in, and the road's own for the traffic leaving", () => {
    const occupancy = new Occupancy();
    const signs = placeSpeedSigns(
      town([rural, highway]),
      [
        { roadIndex: 0, distanceMeters: 100, direction: 'forward' },
        { roadIndex: 1, distanceMeters: 1100, direction: 'backward' },
      ],
      occupancy,
    );

    expect(signs).toHaveLength(4);
    const [ruralIn, ruralOut, highwayIn, highwayOut] = signs;
    // Coming in forward (+x): past the board, on the right (+z), facing back toward -x.
    expect(ruralIn).toMatchObject({ x: expect.closeTo(-600 + 128, 6), z: expect.closeTo(4 + 2.4, 6), limitKmh: TOWN_SPEED_LIMIT_KMH });
    expect(ruralIn!.heading).toBeCloseTo(-Math.PI / 2, 6);
    // Leaving backward (-x): before the board, on its right (-z), facing +x.
    expect(ruralOut).toMatchObject({ x: expect.closeTo(-600 + 72, 6), z: expect.closeTo(-(4 + 2.4), 6), limitKmh: 70 });
    expect(ruralOut!.heading).toBeCloseTo(Math.PI / 2, 6);
    expect(highwayIn).toMatchObject({ x: expect.closeTo(-600 + 1100 - 28, 6), limitKmh: TOWN_SPEED_LIMIT_KMH });
    expect(highwayOut).toMatchObject({ x: expect.closeTo(-600 + 1100 + 28, 6), limitKmh: 90 });
    for (const sign of signs) {
      expect(occupancy.isFree(sign.x, sign.z, 0.01, 0)).toBe(false);
    }
  });

  it('leaves a sign out where something stands', () => {
    const occupancy = new Occupancy();
    occupancy.add(-600 + 128, 4 + 2.4, 0.5);

    const signs = placeSpeedSigns(town([rural]), [{ roadIndex: 0, distanceMeters: 100, direction: 'forward' }], occupancy);

    expect(signs.map((sign) => sign.limitKmh)).toEqual([70]);
  });
});
