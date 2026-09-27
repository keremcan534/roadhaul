import { describe, expect, it } from 'vitest';
import type { Point2 } from '../../../../src/data/definitions/MapDefinition';
import { isClearRun, LandRouter, spaceOut } from '../../../../src/domain/world/landRoutes';

const ANYWHERE = (): boolean => true;
/** The router's legs are this long at most, meters. */
const MAX_LEG_METERS = 110;

function legLengths(way: readonly Point2[]): number[] {
  return way.slice(1).map(([x, z], index) => Math.hypot(x - way[index]![0], z - way[index]![1]));
}

function wayLength(way: readonly Point2[]): number {
  return legLengths(way).reduce((sum, leg) => sum + leg, 0);
}

/** Every point along the way, every half metre, that `isOpen` refuses. */
function refusedAlong(way: readonly Point2[], isOpen: (x: number, z: number) => boolean): Point2[] {
  const refused: Point2[] = [];
  way.slice(1).forEach(([bx, bz], index) => {
    const [ax, az] = way[index]!;
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5);
    for (let step = 0; step <= steps; step++) {
      const x = ax + ((bx - ax) * step) / steps;
      const z = az + ((bz - az) * step) / steps;
      if (!isOpen(x, z)) {
        refused.push([x, z]);
      }
    }
  });
  return refused;
}

/**
 * A wall of land that is not open, 64 m thick (two of the router's 32 m
 * cells, its sides on their edges, so the grid sees it as it is), from the
 * map's north edge to `southZ`; `inset` meters in from its sides.
 */
function wall(southZ: number, inset = 0): (x: number, z: number) => boolean {
  return (x, z) => x > -32 + inset && x < 32 - inset && z > southZ + inset;
}

/**
 * A way keeps out of a wall but for its corners: a straight run is looked
 * along every 5 m, so it may cut one by a little, never 3 m.
 */
function outOfWall(southZ: number): (x: number, z: number) => boolean {
  const deepIn = wall(southZ, 3);
  return (x, z) => !deepIn(x, z);
}

/** Across the middle of a 1,024 m map, from its north edge to 256 m south of its middle. */
const inWall = wall(-256);
const besideWall = (x: number, z: number): boolean => !inWall(x, z);

describe('LandRouter', () => {
  it('finds a way across open land from exactly one end to exactly the other, in legs of at most 110 m', () => {
    const router = new LandRouter({ halfSizeMeters: 500, isLandOpen: ANYWHERE });
    const way = router.route(-400, -300, 350, 320, ANYWHERE)!;

    expect(way).not.toBeNull();
    expect(way[0]).toEqual([-400, -300]);
    expect(way[way.length - 1]).toEqual([350, 320]);
    expect(Math.max(...legLengths(way))).toBeLessThanOrEqual(MAX_LEG_METERS + 1e-9);
    // Hardly longer than the straight line: nothing is in the way.
    expect(wayLength(way)).toBeLessThan(Math.hypot(750, 620) * 1.05);
  });

  it('goes round land that is not open, turning on open land and cutting its corners by a metre or two at most', () => {
    const router = new LandRouter({ halfSizeMeters: 512, isLandOpen: besideWall });
    const way = router.route(-200, 100, 200, 100, ANYWHERE)!;

    expect(way).not.toBeNull();
    expect(way[0]).toEqual([-200, 100]);
    expect(way[way.length - 1]).toEqual([200, 100]);
    expect(way.filter(([x, z]) => inWall(x, z))).toEqual([]);
    expect(refusedAlong(way, outOfWall(-256))).toEqual([]);
    // Round the south end of the wall, but not far round it.
    expect(Math.min(...way.map(([, z]) => z))).toBeLessThan(-256);
    expect(Math.min(...way.map(([, z]) => z))).toBeGreaterThan(-400);
    expect(Math.max(...legLengths(way))).toBeLessThanOrEqual(MAX_LEG_METERS + 1e-9);
  });

  it('goes round where a road may not pass, asking that only where the land is open', () => {
    const asked: Point2[] = [];
    // The road may not pass south of z = -320 near the wall: only a 64 m gap is left below it.
    const mayPass = (x: number, z: number): boolean => {
      asked.push([x, z]);
      return !(z < -320 && Math.abs(x) < 300);
    };
    const router = new LandRouter({ halfSizeMeters: 512, isLandOpen: besideWall });
    const way = router.route(-200, 100, 200, 100, mayPass)!;

    expect(way).not.toBeNull();
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.filter(([x, z]) => inWall(x, z))).toEqual([]);
    expect(refusedAlong(way, (x, z) => outOfWall(-256)(x, z) && !(z < -323 && Math.abs(x) < 297))).toEqual([]);
  });

  it('takes the cells holding its ends as open, however the land lies there', () => {
    // A 10 m pond round the start: the way leaves it, and starts exactly there.
    const router = new LandRouter({ halfSizeMeters: 500, isLandOpen: (x, z) => Math.hypot(x + 300, z) > 10 });
    const way = router.route(-300, 0, 300, 0, ANYWHERE)!;

    expect(way).not.toBeNull();
    expect(way[0]).toEqual([-300, 0]);
    expect(way[way.length - 1]).toEqual([300, 0]);
  });

  it('finds no way out of land closed all round, nor into it, nor to or from beyond the map', () => {
    const ring = (x: number, z: number): boolean => {
      const distance = Math.hypot(x - 100, z - 100);
      return distance > 80 && distance < 200;
    };
    const router = new LandRouter({ halfSizeMeters: 1000, isLandOpen: (x, z) => !ring(x, z) });

    expect(router.route(100, 100, -600, -600, ANYWHERE)).toBeNull();
    expect(router.route(-600, -600, 100, 100, ANYWHERE)).toBeNull();
    expect(router.route(-600, -600, 600, -600, ANYWHERE)).not.toBeNull();
    expect(router.route(-1200, 0, -600, -600, ANYWHERE)).toBeNull();
    expect(router.route(-600, -600, -600, 1100, ANYWHERE)).toBeNull();
  });

  it('gives up on a way far round between ends close together, but not between ends far apart', () => {
    // A wall 6 km long: 200 m apart either side of it, the way round is 6 km, not worth the look…
    const longWall = wall(-3008);
    const router = new LandRouter({ halfSizeMeters: 3200, isLandOpen: (x, z) => !longWall(x, z) });

    expect(router.route(-100, 0, 100, 0, ANYWHERE)).toBeNull();
    // …but it is for ends 4 km apart.
    const way = router.route(-2000, 2000, 2000, 2000, ANYWHERE)!;
    expect(way).not.toBeNull();
    expect(refusedAlong(way, outOfWall(-3008))).toEqual([]);
    // And round a short wall.
    const shortWall = wall(-320);
    const near = new LandRouter({ halfSizeMeters: 3200, isLandOpen: (x, z) => !shortWall(x, z) }).route(-100, 0, 100, 0, ANYWHERE);
    expect(near).not.toBeNull();
    expect(refusedAlong(near!, outOfWall(-320))).toEqual([]);
  });

  it('finds the same way every time, however many it found before', () => {
    const first = new LandRouter({ halfSizeMeters: 512, isLandOpen: besideWall });
    const way = first.route(-200, 100, 200, 100, ANYWHERE);
    first.route(-300, -300, 300, 300, ANYWHERE);

    expect(first.route(-200, 100, 200, 100, ANYWHERE)).toEqual(way);
    expect(new LandRouter({ halfSizeMeters: 512, isLandOpen: besideWall }).route(-200, 100, 200, 100, ANYWHERE)).toEqual(way);
  });
});

describe('spaceOut', () => {
  it('splits the legs longer than 110 m into equal pieces, keeping every point it was given as it was', () => {
    const start: Point2 = [0, 0];
    const end: Point2 = [250, 0];
    const spaced = spaceOut([start, end]);

    expect(spaced).toHaveLength(4);
    expect(spaced[0]).toBe(start);
    expect(spaced[3]).toBe(end);
    expect(spaced[1]![0]).toBeCloseTo(250 / 3, 9);
    expect(spaced[2]![0]).toBeCloseTo(500 / 3, 9);
    expect(spaced.every(([, z]) => z === 0)).toBe(true);
  });

  it('leaves the legs of 110 m and less alone, a point given twice too', () => {
    expect(
      spaceOut([
        [0, 0],
        [110, 0],
        [110, 0],
        [110, 330],
      ]),
    ).toEqual([
      [0, 0],
      [110, 0],
      [110, 0],
      [110, 110],
      [110, 220],
      [110, 330],
    ]);
  });

  it('keeps every leg within the length asked for, ending exactly where the line ends', () => {
    const line: Point2[] = [
      [0.1, 0.2],
      [123.4, 567.8],
      [-40.7, 300.3],
    ];
    const spaced = spaceOut(line, 30);

    expect(spaced[0]).toBe(line[0]);
    expect(spaced[spaced.length - 1]).toBe(line[2]);
    expect(spaced).toContain(line[1]);
    expect(Math.max(...legLengths(spaced))).toBeLessThanOrEqual(30 + 1e-9);
    expect(spaceOut([[0, 0], [100, 0]], 30)).toEqual([
      [0, 0],
      [25, 0],
      [50, 0],
      [75, 0],
      [100, 0],
    ]);
  });
});

describe('isClearRun', () => {
  it('looks along the run every 5 m or less, from past its start to its end', () => {
    const looked: Point2[] = [];
    const look = (x: number, z: number): boolean => {
      looked.push([x, z]);
      return true;
    };

    expect(isClearRun(0, 0, 12, 0, look)).toBe(true);
    expect(looked).toEqual([
      [4, 0],
      [8, 0],
      [12, 0],
    ]);
    looked.length = 0;
    expect(isClearRun(7, 7, 7, 7, look)).toBe(true);
    expect(looked).toEqual([[7, 7]]);
  });

  it('is blocked by anything 5 m and more across in its way, or at its end, but not at its start', () => {
    const strip = (x: number): boolean => !(x > 47 && x < 52);

    expect(isClearRun(0, 0, 100, 0, (x) => strip(x))).toBe(false);
    expect(isClearRun(0, 0, 40, 0, (x) => strip(x))).toBe(true);
    expect(isClearRun(0, 0, 100, 0, (x) => x !== 100)).toBe(false);
    expect(isClearRun(0, 0, 100, 0, (x) => x !== 0)).toBe(true);
  });
});
