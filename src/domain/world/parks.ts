import { SeededRandom } from '../../core/random/SeededRandom';
import type { ParkDefinition, Point2, RectangleDefinition } from '../../data/definitions/MapDefinition';
import type { WallPiece } from './bridges';
import type { StreetFurniture } from './townscape';

/** A park's gravel paths are this wide, meters, and meet on a round plaza this big round the fountain. */
export const PARK_PATH_WIDTH_METERS = 3;
export const PARK_PLAZA_RADIUS_METERS = 7;
/** The fountain's stone basin: its radius, meters (solid). */
export const PARK_FOUNTAIN_RADIUS_METERS = 2.6;
/** The hedge round a park stands this far inside its edge, meters, open this wide where a path comes in. */
export const PARK_HEDGE_INSET_METERS = 0.6;
const HEDGE_OPENING_METERS = PARK_PATH_WIDTH_METERS + 1.6;
/** Trees ring the lawn this far inside the park's edge, about this far apart, meters, clear of the paths' ends. */
const RING_TREE_INSET_METERS = 4.5;
const RING_TREE_SPACING_METERS = 10;
const RING_TREE_PATH_CLEARANCE_METERS = 5;
/** A few more trees stand out on each quarter of the lawn, this far from any path and from the ring. */
const LAWN_TREES_PER_QUARTER = 2;
const LAWN_TREE_CLEARANCE_METERS = 6;
/** Along each path from the plaza: benches by turns on either side, the first this far out, then this far apart. */
const BENCH_FIRST_METERS = 4;
const BENCH_SPACING_METERS = 12;
/** A bench stands this far from the path's middle, facing it; a bin beside every other bench, this far along. */
const BENCH_OFFSET_METERS = PARK_PATH_WIDTH_METERS / 2 + 0.9;
const BIN_ALONG_METERS = 1.3;
/** Lamps light the paths from their side, the first this far out from the plaza, then this far apart. */
const LAMP_FIRST_METERS = 9;
const LAMP_SPACING_METERS = 16;
const LAMP_OFFSET_METERS = PARK_PATH_WIDTH_METERS / 2 + 0.6;
/** Nothing stands this close to the park's edge along a path, meters: the entrances stay open. */
const ENTRANCE_METERS = 3;
const BENCH_RADIUS = 0.55;
const BIN_RADIUS = 0.3;

/** A straight run from a to b, [x, z] each. */
export interface ParkLine {
  readonly a: Point2;
  readonly b: Point2;
}

/**
 * A town park as laid out: a lawn in its rectangle, two gravel paths across
 * it (along its length and across it) meeting on a round plaza with a
 * fountain in the middle, and a low hedge round it, open where the paths
 * come in.
 */
export interface Park {
  readonly id: string;
  readonly area: RectangleDefinition;
  /** The paths, each across the whole park through its middle. */
  readonly paths: readonly ParkLine[];
  /** The fountain: a round stone basin in the plaza's middle, solid. */
  readonly fountain: { readonly x: number; readonly z: number; readonly radius: number };
  /** The hedge, in straight runs round the edge, broken at the paths. */
  readonly hedges: readonly ParkLine[];
}

/** What stands in a park besides its paths, fountain and hedge, before the world checks each has room. */
export interface ParkLayout {
  readonly park: Park;
  /** Broadleaf trees: a ring round the lawn and a few out on it. */
  readonly trees: readonly { readonly x: number; readonly z: number; readonly scale: number }[];
  /** Benches facing the paths, and bins beside some of them. */
  readonly furniture: readonly StreetFurniture[];
  /** Lamps beside the paths, their heads reaching over them (heading: the way the head reaches). */
  readonly lamps: readonly { readonly x: number; readonly z: number; readonly heading: number }[];
}

/**
 * Lays out a park in its rectangle (see Park). The same seed always lays
 * out the same park.
 */
export function layoutPark(definition: ParkDefinition, seed: number): ParkLayout {
  const { area } = definition;
  const random = new SeededRandom(seed ^ 0x5ca1ab1e);
  const heading = (area.headingDegrees * Math.PI) / 180;
  // The park's own frame: `v` along its length, `u` across it (to the right of the length).
  const alongX = Math.sin(heading);
  const alongZ = Math.cos(heading);
  const acrossX = Math.cos(heading);
  const acrossZ = -Math.sin(heading);
  const at = (u: number, v: number): Point2 => [area.x + acrossX * u + alongX * v, area.z + acrossZ * u + alongZ * v];
  const halfLength = area.lengthMeters / 2;
  const halfWidth = area.widthMeters / 2;

  const paths: ParkLine[] = [
    { a: at(0, -halfLength), b: at(0, halfLength) },
    { a: at(-halfWidth, 0), b: at(halfWidth, 0) },
  ];

  // The hedge: each side from corner to corner, open in its middle where a path comes in.
  const hedges: ParkLine[] = [];
  const hu = halfWidth - PARK_HEDGE_INSET_METERS;
  const hv = halfLength - PARK_HEDGE_INSET_METERS;
  const gap = HEDGE_OPENING_METERS / 2;
  for (const side of [1, -1]) {
    hedges.push({ a: at(-hu, side * hv), b: at(-gap, side * hv) }, { a: at(gap, side * hv), b: at(hu, side * hv) });
    hedges.push({ a: at(side * hu, -hv), b: at(side * hu, -gap) }, { a: at(side * hu, gap), b: at(side * hu, hv) });
  }

  const trees: { x: number; z: number; scale: number }[] = [];
  const plant = (u: number, v: number): void => {
    const [x, z] = at(u, v);
    trees.push({ x, z, scale: random.range(0.95, 1.35) });
  };
  // The ring: along each side, inside the hedge, clear of where the paths come in.
  const ru = halfWidth - RING_TREE_INSET_METERS;
  const rv = halfLength - RING_TREE_INSET_METERS;
  const ring = (fromU: number, fromV: number, toU: number, toV: number): void => {
    const length = Math.hypot(toU - fromU, toV - fromV);
    const steps = Math.max(1, Math.round(length / RING_TREE_SPACING_METERS));
    for (let i = 0; i < steps; i++) {
      const u = fromU + ((toU - fromU) * i) / steps;
      const v = fromV + ((toV - fromV) * i) / steps;
      if (Math.abs(u) > RING_TREE_PATH_CLEARANCE_METERS && Math.abs(v) > RING_TREE_PATH_CLEARANCE_METERS) {
        plant(u, v);
      }
    }
  };
  ring(-ru, -rv, ru, -rv);
  ring(ru, -rv, ru, rv);
  ring(ru, rv, -ru, rv);
  ring(-ru, rv, -ru, -rv);
  // A few out on each quarter of the lawn, clear of the paths, the plaza and the ring.
  for (const [su, sv] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    const minU = LAWN_TREE_CLEARANCE_METERS;
    const minV = LAWN_TREE_CLEARANCE_METERS;
    const maxU = ru - LAWN_TREE_CLEARANCE_METERS;
    const maxV = rv - LAWN_TREE_CLEARANCE_METERS;
    for (let i = 0; i < LAWN_TREES_PER_QUARTER; i++) {
      const u = random.range(minU, Math.max(minU, maxU));
      const v = random.range(minV, Math.max(minV, maxV));
      if (maxU > minU && maxV > minV && Math.hypot(u, v) > PARK_PLAZA_RADIUS_METERS + LAWN_TREE_CLEARANCE_METERS) {
        plant(su * u, sv * v);
      }
    }
  }

  // Along each of the four arms of the paths, out from the plaza: benches by turns either side, bins beside every
  // other one, and lamps.
  const furniture: StreetFurniture[] = [];
  const lamps: { x: number; z: number; heading: number }[] = [];
  const arms = [
    { reach: halfLength, u: 0, v: 1 },
    { reach: halfLength, u: 0, v: -1 },
    { reach: halfWidth, u: 1, v: 0 },
    { reach: halfWidth, u: -1, v: 0 },
  ];
  for (const arm of arms) {
    // To the arm's left: (-v, u) in the park's frame.
    const leftU = -arm.v;
    const leftV = arm.u;
    const end = arm.reach - ENTRANCE_METERS;
    let turn = 0;
    for (let out = PARK_PLAZA_RADIUS_METERS + BENCH_FIRST_METERS; out <= end; out += BENCH_SPACING_METERS) {
      const side = turn % 2 === 0 ? 1 : -1;
      const u = arm.u * out + leftU * side * BENCH_OFFSET_METERS;
      const v = arm.v * out + leftV * side * BENCH_OFFSET_METERS;
      const [x, z] = at(u, v);
      // Facing the path: back across toward its middle.
      const faceX = -(acrossX * leftU + alongX * leftV) * side;
      const faceZ = -(acrossZ * leftU + alongZ * leftV) * side;
      const face = Math.atan2(faceX, faceZ);
      furniture.push({ kind: 'bench', x, z, heading: face, radius: BENCH_RADIUS });
      if (turn % 2 === 0 && out + BIN_ALONG_METERS <= end) {
        const [binX, binZ] = at(u + arm.u * BIN_ALONG_METERS, v + arm.v * BIN_ALONG_METERS);
        furniture.push({ kind: 'bin', x: binX, z: binZ, heading: face, radius: BIN_RADIUS });
      }
      turn++;
    }
    let lampTurn = 0;
    for (let out = PARK_PLAZA_RADIUS_METERS + LAMP_FIRST_METERS; out <= end; out += LAMP_SPACING_METERS) {
      // Across the path from the bench nearest it.
      const side = lampTurn++ % 2 === 0 ? -1 : 1;
      const [x, z] = at(arm.u * out + leftU * side * LAMP_OFFSET_METERS, arm.v * out + leftV * side * LAMP_OFFSET_METERS);
      const reachX = -(acrossX * leftU + alongX * leftV) * side;
      const reachZ = -(acrossZ * leftU + alongZ * leftV) * side;
      lamps.push({ x, z, heading: Math.atan2(reachX, reachZ) });
    }
  }

  return {
    park: {
      id: definition.id,
      area,
      paths,
      fountain: { x: area.x, z: area.z, radius: PARK_FOUNTAIN_RADIUS_METERS },
      hedges,
    },
    trees,
    furniture,
    lamps,
  };
}

/** Whether (x, z) lies on one of the park's paths or its plaza (with `margin` meters to spare). */
export function onParkPath(park: Park, x: number, z: number, margin = 0): boolean {
  if (Math.hypot(x - park.area.x, z - park.area.z) <= PARK_PLAZA_RADIUS_METERS + margin) {
    return true;
  }
  const half = PARK_PATH_WIDTH_METERS / 2 + margin;
  return park.paths.some(({ a, b }) => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / lengthSquared)) : 0;
    return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t)) <= half;
  });
}

/** The park's hedge as walls facing out of it: the truck stops at the hedge. */
export function hedgeWalls(park: Park): WallPiece[] {
  return park.hedges.map(({ a, b }) => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz) || 1;
    // Across the run, the way away from the park's middle.
    let nx = dz / length;
    let nz = -dx / length;
    if (((a[0] + b[0]) / 2 - park.area.x) * nx + ((a[1] + b[1]) / 2 - park.area.z) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    return { a, b, nx, nz };
  });
}
