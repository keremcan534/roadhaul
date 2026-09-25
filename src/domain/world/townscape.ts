import type { RoadDirection } from '../../data/definitions/MapDefinition';
import type { Occupancy } from './countryside';
import { cellKey, cellOf } from './gridCells';
import { createRoadPoint, type RoadPath } from './RoadPath';

/**
 * The towns' streetscape, and the signs on the roads between them, placed
 * once from the roads: pavements with kerbs along both sides of every town
 * street (broken where a junction, a yard or a turning circle opens off
 * it), benches and litter bins along them, a bus shelter on each street,
 * billboards on the roads into the towns, and the speed limits where a
 * road enters a town and leaves it.
 */

/** A pavement along one side of a street, from one distance along it to another (meters from its first point). */
export interface Sidewalk {
  readonly roadIndex: number;
  /** 1: right of the road's direction (toward its last point), -1: left. */
  readonly side: 1 | -1;
  readonly fromMeters: number;
  readonly toMeters: number;
}

/** Pavements are this wide from the road's edge, and their kerbs this tall. */
export const SIDEWALK_WIDTH_METERS = 2.6;
export const KERB_HEIGHT_METERS = 0.14;

export const STREET_FURNITURE_KINDS = ['bench', 'bin', 'busStop'] as const;
export type StreetFurnitureKind = (typeof STREET_FURNITURE_KINDS)[number];

/** A bench, bin or bus shelter on a pavement, facing the road (heading: the way its front faces, 0 along +z). */
export interface StreetFurniture {
  readonly kind: StreetFurnitureKind;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly radius: number;
}

/** A billboard on two legs beside a road into a town, turned toward the traffic coming in; `ad` picks its poster. */
export interface Billboard {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly ad: number;
}

/** Billboards stand on legs this far either side of their middle, the truck hits a leg's radius. */
export const BILLBOARD_LEG_SPACING_METERS = 3.2;
export const BILLBOARD_LEG_RADIUS_METERS = 0.18;
/** How many different posters there are (StreetView draws them). */
export const BILLBOARD_ADS = 4;

/** A speed limit sign facing the traffic it is for (heading: the way its face looks, 0 along +z). */
export interface SpeedSign {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly limitKmh: number;
  readonly radius: number;
}

/** In a town the limit is this; out of it, the road's own. */
export const TOWN_SPEED_LIMIT_KMH = 50;
const ROAD_SPEED_LIMITS_KMH: Readonly<Record<RoadPath['kind'], number>> = { street: 50, ringRoad: 50, highway: 90, rural: 70 };

/** What placing the streetscape needs to know of the world. */
export interface TownGround {
  readonly roads: readonly RoadPath[];
  /** Whether a pavement may run at (x, z): off every other road and out of yards, lots, turning circles and quays. */
  isClearForWalk(x: number, z: number): boolean;
  /** Whether something the size of a tree may stand at (x, z) (SceneryGround.isClear). */
  isClear(x: number, z: number): boolean;
}

/** A city's name board as the world places it: the road it stands on, how far along, and the traffic it greets. */
export interface TownEntry {
  readonly roadIndex: number;
  readonly distanceMeters: number;
  readonly direction: RoadDirection;
}

/** Pavements are walked in steps this long; shorter pieces than this are left out. */
const WALK_STEP_METERS = 1;
const SHORTEST_SIDEWALK_METERS = 8;
/** Benches and bins take turns this far apart along a pavement, near its back, clear of the lamps. */
const FURNITURE_SPACING_METERS = 38;
const FURNITURE_BACK_METERS = 0.55;
const FURNITURE_RADIUS: Readonly<Record<StreetFurnitureKind, number>> = { bench: 0.55, bin: 0.3, busStop: 1.6 };
/** A bus shelter stands at the back of its pavement, its middle this far behind the kerb. */
const SHELTER_BACK_METERS = SIDEWALK_WIDTH_METERS + 1.1;
/** Billboards: how far from the town's end of the road, and how far back from its edge. */
const BILLBOARD_FROM_TOWN_METERS = 260;
const BILLBOARD_BACK_METERS = 11;
/** …turned this far (radians) from square to the road, toward it. */
const BILLBOARD_TURN = 0.35;
/** Speed limits stand this far past the town's name board, this far out from the road's edge. */
const SPEED_SIGN_PAST_BOARD_METERS = 28;
const SPEED_SIGN_OUT_METERS = 2.4;
const SPEED_SIGN_RADIUS_METERS = 0.08;

/**
 * The pavements: both sides of every street, where they run clear of other
 * roads and of yards, in pieces at least SHORTEST_SIDEWALK_METERS long.
 */
export function placeSidewalks(ground: TownGround): Sidewalk[] {
  const sidewalks: Sidewalk[] = [];
  const point = createRoadPoint();
  ground.roads.forEach((road, roadIndex) => {
    if (road.kind !== 'street') {
      return;
    }
    for (const side of [1, -1] as const) {
      const out = side * (road.widthMeters / 2 + SIDEWALK_WIDTH_METERS / 2);
      let from = -1;
      for (let along = 0; along <= road.lengthMeters; along += WALK_STEP_METERS) {
        road.pointAt(along, point);
        const clear = ground.isClearForWalk(point.x - point.directionZ * out, point.z + point.directionX * out);
        if (clear && from < 0) {
          from = along;
        } else if (!clear && from >= 0) {
          if (along - from >= SHORTEST_SIDEWALK_METERS) {
            sidewalks.push({ roadIndex, side, fromMeters: from, toMeters: along - WALK_STEP_METERS });
          }
          from = -1;
        }
      }
      if (from >= 0 && road.lengthMeters - from >= SHORTEST_SIDEWALK_METERS) {
        sidewalks.push({ roadIndex, side, fromMeters: from, toMeters: road.lengthMeters });
      }
    }
  });
  return sidewalks;
}

/** A pavement's outline has a row at least this often along it. */
const OUTLINE_STEP_METERS = 2;
/** The numbers per row of an outline (sidewalkOutline). */
export const OUTLINE_ROW = 5;

/**
 * A pavement's outline, in rows evenly apart (at most OUTLINE_STEP_METERS)
 * from one end to the other: per row, how far along the road it is, then
 * x and z of the kerb's top edge and of the pavement's back. The pavement
 * drawn (SceneryView) and the ground under the wheels (PavementGrid) both
 * follow it.
 */
export function sidewalkOutline(road: RoadPath, sidewalk: Sidewalk): Float64Array {
  const point = createRoadPoint();
  const kerb = road.widthMeters / 2;
  const back = kerb + SIDEWALK_WIDTH_METERS;
  const length = sidewalk.toMeters - sidewalk.fromMeters;
  const steps = Math.max(1, Math.ceil(length / OUTLINE_STEP_METERS));
  const rows = new Float64Array((steps + 1) * OUTLINE_ROW);
  for (let i = 0; i <= steps; i++) {
    const along = sidewalk.fromMeters + (length * i) / steps;
    road.pointAt(along, point);
    // Across the road toward the pavement's side: right of the road's direction is (-dz, dx).
    const acrossX = -point.directionZ * sidewalk.side;
    const acrossZ = point.directionX * sidewalk.side;
    const at = i * OUTLINE_ROW;
    rows[at] = along;
    rows[at + 1] = point.x + acrossX * kerb;
    rows[at + 2] = point.z + acrossZ * kerb;
    rows[at + 3] = point.x + acrossX * back;
    rows[at + 4] = point.z + acrossZ * back;
  }
  return rows;
}

/**
 * The pavements' pieces (between neighbouring rows of their outlines) filed
 * by grid cell, so the ground under a point (DrivingWorld.surfaceAt, asked
 * every fixed step) knows a pavement from the few pieces around it. Built
 * once per world.
 */
export class PavementGrid {
  /** Per cell: each piece's four corners in turn round it, x and z each (eight numbers a piece). */
  private readonly cells = new Map<number, Float64Array>();

  constructor(roads: readonly RoadPath[], sidewalks: readonly Sidewalk[]) {
    const building = new Map<number, number[]>();
    for (const sidewalk of sidewalks) {
      const rows = sidewalkOutline(roads[sidewalk.roadIndex]!, sidewalk);
      for (let a = 0; a + OUTLINE_ROW < rows.length; a += OUTLINE_ROW) {
        const b = a + OUTLINE_ROW;
        // Round the piece: this row's kerb and back, the next row's back and kerb.
        const corners = [rows[a + 1]!, rows[a + 2]!, rows[a + 3]!, rows[a + 4]!, rows[b + 3]!, rows[b + 4]!, rows[b + 1]!, rows[b + 2]!];
        const xs = [corners[0]!, corners[2]!, corners[4]!, corners[6]!];
        const zs = [corners[1]!, corners[3]!, corners[5]!, corners[7]!];
        for (let cellX = cellOf(Math.min(...xs)); cellX <= cellOf(Math.max(...xs)); cellX++) {
          for (let cellZ = cellOf(Math.min(...zs)); cellZ <= cellOf(Math.max(...zs)); cellZ++) {
            const key = cellKey(cellX, cellZ);
            const pieces = building.get(key);
            if (pieces === undefined) {
              building.set(key, [...corners]);
            } else {
              pieces.push(...corners);
            }
          }
        }
      }
    }
    for (const [key, pieces] of building) {
      this.cells.set(key, Float64Array.from(pieces));
    }
  }

  /** True when (x, z) is on a pavement. Allocation-free. */
  contains(x: number, z: number): boolean {
    const pieces = this.cells.get(cellKey(cellOf(x), cellOf(z)));
    if (pieces === undefined) {
      return false;
    }
    for (let k = 0; k < pieces.length; k += 8) {
      if (insidePiece(pieces, k, x, z)) {
        return true;
      }
    }
    return false;
  }
}

/** Whether (x, z) is inside the four-cornered piece at `k` of `corners` (convex, wound either way). */
function insidePiece(corners: Float64Array, k: number, x: number, z: number): boolean {
  let left = false;
  let right = false;
  for (let i = 0; i < 4; i++) {
    const ax = corners[k + i * 2]!;
    const az = corners[k + i * 2 + 1]!;
    const next = k + ((i + 1) % 4) * 2;
    const cross = (corners[next]! - ax) * (z - az) - (corners[next + 1]! - az) * (x - ax);
    left ||= cross > 0;
    right ||= cross < 0;
  }
  return !(left && right);
}

/**
 * What stands on the pavements: a bus shelter at the back of each street's
 * longest pavement on the right, and benches and bins by turns along every
 * pavement, clear of lamps and of one another. All solid (filed in
 * `occupancy`, which holds the street lamps already).
 */
export function placeStreetFurniture(ground: TownGround, sidewalks: readonly Sidewalk[], occupancy: Occupancy): StreetFurniture[] {
  const furniture: StreetFurniture[] = [];
  const point = createRoadPoint();
  const standAt = (road: RoadPath, along: number, side: 1 | -1, back: number): { x: number; z: number; heading: number } => {
    road.pointAt(along, point);
    const out = side * (road.widthMeters / 2 + back);
    // It faces the road: toward the centreline, across the direction of travel.
    return {
      x: point.x - point.directionZ * out,
      z: point.z + point.directionX * out,
      heading: Math.atan2(point.directionZ * side, -point.directionX * side),
    };
  };
  const put = (kind: StreetFurnitureKind, spot: { x: number; z: number; heading: number }): boolean => {
    const radius = FURNITURE_RADIUS[kind];
    if (!occupancy.isFree(spot.x, spot.z, radius, 1)) {
      return false;
    }
    furniture.push({ kind, ...spot, radius });
    occupancy.add(spot.x, spot.z, radius);
    return true;
  };

  // A bus shelter on each street: in the middle of its longest pavement on the right.
  const streets = new Set(sidewalks.map((sidewalk) => sidewalk.roadIndex));
  for (const roadIndex of streets) {
    const longest = sidewalks
      .filter((sidewalk) => sidewalk.roadIndex === roadIndex && sidewalk.side === 1)
      .reduce<Sidewalk | null>((best, sidewalk) => (best === null || sidewalk.toMeters - sidewalk.fromMeters > best.toMeters - best.fromMeters ? sidewalk : best), null);
    if (longest === null) {
      continue;
    }
    const road = ground.roads[roadIndex]!;
    const middle = (longest.fromMeters + longest.toMeters) / 2;
    for (const shift of [0, 12, -12, 24, -24]) {
      const spot = standAt(road, middle + shift, 1, SHELTER_BACK_METERS);
      if (ground.isClearForWalk(spot.x, spot.z) && put('busStop', spot)) {
        break;
      }
    }
  }

  // Benches and bins by turns along every pavement.
  let turn = 0;
  for (const sidewalk of sidewalks) {
    const road = ground.roads[sidewalk.roadIndex]!;
    for (let along = sidewalk.fromMeters + FURNITURE_SPACING_METERS / 2; along < sidewalk.toMeters - 4; along += FURNITURE_SPACING_METERS) {
      const kind: StreetFurnitureKind = turn++ % 2 === 0 ? 'bench' : 'bin';
      put(kind, standAt(road, along, sidewalk.side, SIDEWALK_WIDTH_METERS - FURNITURE_BACK_METERS));
    }
  }
  return furniture;
}

/**
 * Billboards beside the roads into the towns (country roads and the
 * highway), BILLBOARD_FROM_TOWN_METERS out of town, on the right of the
 * traffic heading in and turned a little toward it: each town end of each
 * road gets one, where one can stand. Posters by turns.
 */
export function placeBillboards(ground: TownGround, occupancy: Occupancy): Billboard[] {
  const billboards: Billboard[] = [];
  const point = createRoadPoint();
  let ad = 0;
  for (const road of ground.roads) {
    if (road.kind !== 'rural' && road.kind !== 'highway') {
      continue;
    }
    // Near the start the traffic heading in drives backward (toward the first point), near the end forward.
    for (const [base, direction] of [
      [BILLBOARD_FROM_TOWN_METERS, -1],
      [road.lengthMeters - BILLBOARD_FROM_TOWN_METERS, 1],
    ] as const) {
      for (const shift of [0, 30, -30, 60, -60]) {
        road.pointAt(base + shift, point);
        // Right of the traffic heading `direction` along the road.
        const out = direction * (road.widthMeters / 2 + BILLBOARD_BACK_METERS);
        const x = point.x - point.directionZ * out;
        const z = point.z + point.directionX * out;
        // It faces the oncoming traffic, turned a little toward the road (on its left, as the traffic sees it).
        const heading = Math.atan2(-point.directionX * direction, -point.directionZ * direction) - BILLBOARD_TURN;
        const legs = [-1, 1].map((leg) => [
          x + Math.cos(heading) * leg * (BILLBOARD_LEG_SPACING_METERS / 2),
          z - Math.sin(heading) * leg * (BILLBOARD_LEG_SPACING_METERS / 2),
        ]);
        if (legs.every(([legX, legZ]) => ground.isClear(legX!, legZ!) && occupancy.isFree(legX!, legZ!, BILLBOARD_LEG_RADIUS_METERS, 2))) {
          billboards.push({ x, z, heading, ad: ad++ % BILLBOARD_ADS });
          for (const [legX, legZ] of legs) {
            occupancy.add(legX!, legZ!, BILLBOARD_LEG_RADIUS_METERS);
          }
          break;
        }
      }
    }
  }
  return billboards;
}

/** Where a billboard's legs stand (the truck hits them): either side of its middle, across its face. */
export function billboardLegs(billboard: Billboard): { x: number; z: number; radius: number }[] {
  return [-1, 1].map((leg) => ({
    x: billboard.x + Math.cos(billboard.heading) * leg * (BILLBOARD_LEG_SPACING_METERS / 2),
    z: billboard.z - Math.sin(billboard.heading) * leg * (BILLBOARD_LEG_SPACING_METERS / 2),
    radius: BILLBOARD_LEG_RADIUS_METERS,
  }));
}

/**
 * The speed limits where each road enters a town (at its name board): the
 * town's limit a little past the board for the traffic coming in, and the
 * road's own for the traffic leaving, on its right, as far out of town.
 */
export function placeSpeedSigns(ground: TownGround, entries: readonly TownEntry[], occupancy: Occupancy): SpeedSign[] {
  const signs: SpeedSign[] = [];
  const point = createRoadPoint();
  for (const entry of entries) {
    const road = ground.roads[entry.roadIndex]!;
    // Coming in the traffic drives `inward` along the road.
    const inward = entry.direction === 'forward' ? 1 : -1;
    const place = (distance: number, direction: 1 | -1, limitKmh: number): void => {
      road.pointAt(Math.min(road.lengthMeters, Math.max(0, distance)), point);
      const out = direction * (road.widthMeters / 2 + SPEED_SIGN_OUT_METERS);
      const x = point.x - point.directionZ * out;
      const z = point.z + point.directionX * out;
      if (!occupancy.isFree(x, z, SPEED_SIGN_RADIUS_METERS, 0.8)) {
        return;
      }
      // Its face looks back at the traffic it is for.
      const heading = Math.atan2(-point.directionX * direction, -point.directionZ * direction);
      signs.push({ x, z, heading, limitKmh, radius: SPEED_SIGN_RADIUS_METERS });
      occupancy.add(x, z, SPEED_SIGN_RADIUS_METERS);
    };
    place(entry.distanceMeters + inward * SPEED_SIGN_PAST_BOARD_METERS, inward, TOWN_SPEED_LIMIT_KMH);
    place(entry.distanceMeters - inward * SPEED_SIGN_PAST_BOARD_METERS, inward === 1 ? -1 : 1, ROAD_SPEED_LIMITS_KMH[road.kind]);
  }
  return signs;
}
