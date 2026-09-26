import type { Point2 } from '../../data/definitions/MapDefinition';
import type { RiverPath } from './RiverPath';
import { createRoadPoint, type RoadPath } from './RoadPath';

/** A bridge's deck runs this far past the channel's rim onto the land at each end, meters. */
export const BRIDGE_ABUTMENT_METERS = 4;
/** Its parapets stand this far out from the road's edge, meters: the deck's kerbs. */
export const BRIDGE_KERB_METERS = 0.8;
/** Parapets are cut into pieces about this long, meters. */
const PARAPET_PIECE_METERS = 2;
/** The banks' rims are cut into pieces about this long, meters, and this short near a bridge… */
const RIM_PIECE_METERS = 6;
const RIM_PIECE_NEAR_BRIDGE_METERS = 1;
/** …which is anywhere this close to a bridge's middle, meters. */
const NEAR_BRIDGE_METERS = 60;

/** Where a road crosses a river on a bridge. */
export interface Bridge {
  readonly roadIndex: number;
  readonly riverIndex: number;
  /** Where along the road (its RoadPath distances) the deck starts and ends, meters. */
  readonly fromMeters: number;
  readonly toMeters: number;
  /** Half the deck's width (the road's, and a kerb each side): where its parapets stand from the centreline, meters. */
  readonly halfWidthMeters: number;
  /** The deck's middle, and the road's heading there (radians, 0 along +z). */
  readonly x: number;
  readonly z: number;
  readonly heading: number;
}

/** A straight wall from a to b, and the way from it toward where the truck belongs (a unit vector, x and z). */
export interface WallPiece {
  readonly a: Point2;
  readonly b: Point2;
  readonly nx: number;
  readonly nz: number;
}

/**
 * Where the roads cross the rivers: a bridge for every stretch of a road
 * whose deck (its paved width and kerbs) reaches over a channel's opening,
 * running at least BRIDGE_ABUTMENT_METERS onto the land at each end. (A closed
 * road's stretch across its first sample would count as two; no ring road
 * crosses a river.)
 */
export function findBridges(roads: readonly RoadPath[], rivers: readonly RiverPath[]): Bridge[] {
  const bridges: Bridge[] = [];
  const middle = createRoadPoint();
  const sample = createRoadPoint();
  rivers.forEach((river, riverIndex) => {
    roads.forEach((road, roadIndex) => {
      const opening = river.openingHalfWidthMeters;
      const halfDeck = road.widthMeters / 2 + BRIDGE_KERB_METERS;
      // Over the opening: the centreline or either edge of the deck.
      const reaches = (i: number): boolean => {
        road.pointAt(road.distances[i]!, sample);
        const acrossX = sample.directionZ * halfDeck;
        const acrossZ = -sample.directionX * halfDeck;
        return (
          river.distanceTo(sample.x, sample.z) <= opening ||
          river.distanceTo(sample.x + acrossX, sample.z + acrossZ) <= opening ||
          river.distanceTo(sample.x - acrossX, sample.z - acrossZ) <= opening
        );
      };
      let first = -1;
      for (let i = 0; i <= road.pointCount; i++) {
        const over = i < road.pointCount && reaches(i);
        if (over && first < 0) {
          first = i;
        } else if (!over && first >= 0) {
          // From the last sample short of the opening to the first past it: the rim lies between them.
          const fromMeters = Math.max(0, road.distances[Math.max(0, first - 1)]! - BRIDGE_ABUTMENT_METERS);
          const toMeters = Math.min(road.lengthMeters, road.distances[Math.min(i, road.pointCount - 1)]! + BRIDGE_ABUTMENT_METERS);
          road.pointAt((fromMeters + toMeters) / 2, middle);
          bridges.push({
            roadIndex,
            riverIndex,
            fromMeters,
            toMeters,
            halfWidthMeters: road.widthMeters / 2 + BRIDGE_KERB_METERS,
            x: middle.x,
            z: middle.z,
            heading: Math.atan2(middle.directionX, middle.directionZ),
          });
          first = -1;
        }
      }
    });
  });
  return bridges;
}

/** The parapets along both edges of every bridge's deck, as walls facing the road. */
export function parapetWalls(roads: readonly RoadPath[], bridges: readonly Bridge[]): WallPiece[] {
  const pieces: WallPiece[] = [];
  const point = createRoadPoint();
  for (const bridge of bridges) {
    const road = roads[bridge.roadIndex]!;
    const steps = Math.max(1, Math.ceil((bridge.toMeters - bridge.fromMeters) / PARAPET_PIECE_METERS));
    for (const side of [1, -1]) {
      let previous: Point2 | null = null;
      for (let step = 0; step <= steps; step++) {
        road.pointAt(bridge.fromMeters + ((bridge.toMeters - bridge.fromMeters) * step) / steps, point);
        // (dz, -dx) is left of the road's direction; the wall faces back across the deck.
        const outX = point.directionZ * side;
        const outZ = -point.directionX * side;
        const here: Point2 = [point.x + outX * bridge.halfWidthMeters, point.z + outZ * bridge.halfWidthMeters];
        if (previous !== null) {
          pieces.push({ a: previous, b: here, nx: -outX, nz: -outZ });
        }
        previous = here;
      }
    }
  }
  return pieces;
}

/**
 * The rivers' banks as walls facing the land, along the rim of each
 * channel's opening from its source to the sea (where the shore takes
 * over), broken where a bridge's deck passes over: its parapets close the
 * gap. Near a bridge the rim is cut finely, so the wall ends within a meter
 * of the parapet's line.
 */
export function bankWalls(roads: readonly RoadPath[], rivers: readonly RiverPath[], bridges: readonly Bridge[]): WallPiece[] {
  const pieces: WallPiece[] = [];
  rivers.forEach((river, riverIndex) => {
    const crossings = bridges.filter((bridge) => bridge.riverIndex === riverIndex);
    const underDeck = (x: number, z: number): boolean =>
      crossings.some((bridge) => {
        if (Math.hypot(x - bridge.x, z - bridge.z) > NEAR_BRIDGE_METERS) {
          return false;
        }
        const road = roads[bridge.roadIndex]!;
        const nearest = road.nearestSampleIndex(x, z);
        const along = road.distances[nearest]!;
        return (
          along >= bridge.fromMeters &&
          along <= bridge.toMeters &&
          road.distanceTo(x, z) < bridge.halfWidthMeters + PARAPET_PIECE_METERS / 4
        );
      });
    const nearBridge = (x: number, z: number): boolean =>
      crossings.some((bridge) => Math.hypot(x - bridge.x, z - bridge.z) < NEAR_BRIDGE_METERS);
    const last = Math.min(river.mouthIndex, river.pointCount - 1);
    for (const side of [1, -1]) {
      let previous: Point2 | null = null;
      const rim = (i: number, t: number): Point2 => {
        const j = Math.min(i + 1, river.pointCount - 1);
        const x = river.x(i) + (river.x(j) - river.x(i)) * t;
        const z = river.z(i) + (river.z(j) - river.z(i)) * t;
        const dx = river.directionX(i) + (river.directionX(j) - river.directionX(i)) * t;
        const dz = river.directionZ(i) + (river.directionZ(j) - river.directionZ(i)) * t;
        const length = Math.hypot(dx, dz) || 1;
        return [x + (dz / length) * side * river.openingHalfWidthMeters, z - (dx / length) * side * river.openingHalfWidthMeters];
      };
      for (let i = 0; i < last; i++) {
        const pieceLength = river.distances[i + 1]! - river.distances[i]!;
        const fine = nearBridge(river.x(i), river.z(i));
        const steps = Math.max(1, Math.ceil(pieceLength / (fine ? RIM_PIECE_NEAR_BRIDGE_METERS : RIM_PIECE_METERS)));
        for (let step = i === 0 ? 0 : 1; step <= steps; step++) {
          const here = rim(i, step / steps);
          if (underDeck(here[0], here[1])) {
            previous = null;
            continue;
          }
          if (previous !== null) {
            const dx = here[0] - previous[0];
            const dz = here[1] - previous[1];
            const length = Math.hypot(dx, dz) || 1;
            // Away from the water: the side the rim lies on, across the piece.
            pieces.push({ a: previous, b: here, nx: (dz / length) * side, nz: (-dx / length) * side });
          }
          previous = here;
        }
      }
    }
  });
  return pieces;
}
