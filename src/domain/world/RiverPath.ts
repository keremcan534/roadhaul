import { isInSea, type Point2, type RiverDefinition } from '../../data/definitions/MapDefinition';
import { cellKey, cellOf } from './gridCells';
import { sampleCatmullRom } from './RoadPath';

/** A river's course is sampled about this often, meters. */
const SPACING_METERS = 6;
/** Each bank slopes down to the water over this width, meters: the channel's opening is this much wider each side. */
export const RIVER_BANK_METERS = 7;
/** Inland, the water lies this far below the fields, meters. */
export const RIVER_WATER_DEPTH_METERS = 1.3;
/** Over this last stretch before the sea the river comes up to the sea's level, meters. */
const MOUTH_RISE_METERS = 140;
/** Its course is filed in a grid this far out past its opening: the farthest margin distanceTo() can see. */
const GRID_REACH_METERS = 30;

/**
 * A river's course as a dense polyline, sampled from a Catmull-Rom curve
 * through its points like a road's (RoadPath), with its channel: the water
 * between two sloping banks, sunk below the fields. Inland the water lies
 * RIVER_WATER_DEPTH_METERS down; where the river flows into the sea it
 * comes up to the sea's level over its last stretch (depths). The course is
 * filed in a grid, so how far a point lies from it is found from the few
 * pieces around it: placement asks for every tree and lamp.
 */
export class RiverPath {
  readonly id: string;
  /** The water's width, bank to bank, meters. */
  readonly widthMeters: number;
  /** Half the water's width, and half the opening's (the water and both banks), meters. */
  readonly halfWidthMeters: number;
  readonly openingHalfWidthMeters: number;
  /** Sample positions, x and z interleaved: [x0, z0, x1, z1, …], source first. */
  readonly points: Float64Array;
  /** Distance along the course at each sample, meters. */
  readonly distances: Float64Array;
  readonly lengthMeters: number;
  /**
   * How deep the channel runs at each sample, as a share of
   * RIVER_WATER_DEPTH_METERS: 1 inland, rising to 0 at the sea.
   */
  readonly depths: Float64Array;
  /** The first sample in the sea (the mouth), or the sample count when the river never reaches it. */
  readonly mouthIndex: number;
  /** Per grid cell: the pieces (from sample i to i + 1) within reach of it. */
  private readonly cells = new Map<number, Int32Array>();

  constructor(river: RiverDefinition, shoreline: readonly Point2[] | null = null) {
    this.id = river.id;
    this.widthMeters = river.widthMeters;
    this.halfWidthMeters = river.widthMeters / 2;
    this.openingHalfWidthMeters = this.halfWidthMeters + RIVER_BANK_METERS;
    this.points = sampleCatmullRom(river.points, false, SPACING_METERS);
    const count = this.pointCount;
    this.distances = new Float64Array(count);
    for (let i = 1; i < count; i++) {
      this.distances[i] = this.distances[i - 1]! + Math.hypot(this.x(i) - this.x(i - 1), this.z(i) - this.z(i - 1));
    }
    this.lengthMeters = this.distances[count - 1] ?? 0;

    let mouth = count;
    if (shoreline !== null) {
      for (let i = 0; i < count; i++) {
        if (isInSea(shoreline, this.x(i), this.z(i))) {
          mouth = i;
          break;
        }
      }
    }
    this.mouthIndex = mouth;
    this.depths = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      this.depths[i] =
        i >= mouth ? 0 : mouth === count ? 1 : Math.min(1, (this.distances[mouth]! - this.distances[i]!) / MOUTH_RISE_METERS);
    }

    const reach = this.openingHalfWidthMeters + GRID_REACH_METERS;
    const building = new Map<number, number[]>();
    for (let i = 0; i < count - 1; i++) {
      for (let gx = cellOf(Math.min(this.x(i), this.x(i + 1)) - reach); gx <= cellOf(Math.max(this.x(i), this.x(i + 1)) + reach); gx++) {
        for (let gz = cellOf(Math.min(this.z(i), this.z(i + 1)) - reach); gz <= cellOf(Math.max(this.z(i), this.z(i + 1)) + reach); gz++) {
          const key = cellKey(gx, gz);
          const pieces = building.get(key);
          if (pieces === undefined) {
            building.set(key, [i]);
          } else {
            pieces.push(i);
          }
        }
      }
    }
    for (const [key, pieces] of building) {
      this.cells.set(key, Int32Array.from(pieces));
    }
  }

  get pointCount(): number {
    return this.points.length / 2;
  }

  x(index: number): number {
    return this.points[index * 2] ?? 0;
  }

  z(index: number): number {
    return this.points[index * 2 + 1] ?? 0;
  }

  /**
   * The course's direction at sample `index` (downstream, a unit vector):
   * x, then z. Allocation-free.
   */
  directionX(index: number): number {
    return this.direction(index, 0);
  }

  directionZ(index: number): number {
    return this.direction(index, 1);
  }

  /**
   * How far (x, z) lies from the river's centreline, meters: exact within
   * GRID_REACH_METERS of its opening, Infinity farther off. Allocation-free.
   */
  distanceTo(x: number, z: number): number {
    const pieces = this.cells.get(cellKey(cellOf(x), cellOf(z)));
    if (pieces === undefined) {
      return Number.POSITIVE_INFINITY;
    }
    let best = Number.POSITIVE_INFINITY;
    for (let k = 0; k < pieces.length; k++) {
      const i = pieces[k]!;
      const ax = this.x(i);
      const az = this.z(i);
      const dx = this.x(i + 1) - ax;
      const dz = this.z(i + 1) - az;
      const lengthSquared = dx * dx + dz * dz;
      const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared)) : 0;
      const distance = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (distance < best) {
        best = distance;
      }
    }
    return best;
  }

  /** Whether (x, z) lies in the channel's opening (the water and its banks), or within `margin` meters of it. */
  contains(x: number, z: number, margin = 0): boolean {
    return this.distanceTo(x, z) <= this.openingHalfWidthMeters + margin;
  }

  private direction(index: number, axis: 0 | 1): number {
    const last = this.pointCount - 1;
    const from = Math.max(0, index - 1);
    const to = Math.min(last, index + 1);
    const dx = this.x(to) - this.x(from);
    const dz = this.z(to) - this.z(from);
    const length = Math.hypot(dx, dz) || 1;
    return (axis === 0 ? dx : dz) / length;
  }
}
