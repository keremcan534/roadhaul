import type { Point2, RoadDefinition } from '../../data/definitions/MapDefinition';

/** Target distance between centreline samples, meters. */
const DEFAULT_SPACING_METERS = 4;

/**
 * A road's centreline as a dense polyline, sampled from a Catmull-Rom curve
 * through the road's control points (the curve passes through every point).
 * Both driving (surface, distance) and rendering (road mesh, markings) use
 * these samples, so what you see is what you drive on.
 */
export class RoadPath {
  readonly id: string;
  readonly widthMeters: number;
  readonly closed: boolean;
  /** Sample positions, x and z interleaved: [x0, z0, x1, z1, …]. */
  readonly points: Float64Array;
  /** Distance along the road at each sample, meters. */
  readonly distances: Float64Array;
  readonly lengthMeters: number;

  constructor(road: RoadDefinition, spacingMeters = DEFAULT_SPACING_METERS) {
    this.id = road.id;
    this.widthMeters = road.widthMeters;
    this.closed = road.closed;
    this.points = sampleCatmullRom(road.controlPoints, road.closed, spacingMeters);

    const count = this.pointCount;
    this.distances = new Float64Array(count);
    let total = 0;
    for (let i = 1; i < count; i++) {
      total += Math.hypot(this.x(i) - this.x(i - 1), this.z(i) - this.z(i - 1));
      this.distances[i] = total;
    }
    if (this.closed) {
      total += Math.hypot(this.x(0) - this.x(count - 1), this.z(0) - this.z(count - 1));
    }
    this.lengthMeters = total;
  }

  get pointCount(): number {
    return this.points.length / 2;
  }

  /** Number of straight pieces between samples (closed roads also join the last sample to the first). */
  get segmentCount(): number {
    return this.closed ? this.pointCount : this.pointCount - 1;
  }

  x(index: number): number {
    return this.points[index * 2] ?? 0;
  }

  z(index: number): number {
    return this.points[index * 2 + 1] ?? 0;
  }

  /** Shortest distance from (x, z) to the centreline. Allocation-free. */
  distanceTo(x: number, z: number): number {
    const count = this.pointCount;
    let best = Infinity;
    for (let i = 0; i < this.segmentCount; i++) {
      const next = (i + 1) % count;
      best = Math.min(best, distanceToSegment(x, z, this.x(i), this.z(i), this.x(next), this.z(next)));
    }
    return best;
  }

  /** True when (x, z) is on the paved surface. */
  contains(x: number, z: number): boolean {
    return this.distanceTo(x, z) <= this.widthMeters / 2;
  }

  /** Index of the centreline sample closest to (x, z). Samples are about 4 m apart. Allocation-free. */
  nearestSampleIndex(x: number, z: number): number {
    let best = 0;
    let bestDistanceSquared = Infinity;
    for (let i = 0; i < this.pointCount; i++) {
      const dx = this.x(i) - x;
      const dz = this.z(i) - z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared;
        best = i;
      }
    }
    return best;
  }

  /**
   * Signed distance along the road from sample `from` to sample `to`:
   * positive in the direction of increasing sample index. A closed road
   * takes whichever way round is shorter.
   */
  distanceAlong(from: number, to: number): number {
    const along = (this.distances[to] ?? 0) - (this.distances[from] ?? 0);
    if (!this.closed) {
      return along;
    }
    const forward = ((along % this.lengthMeters) + this.lengthMeters) % this.lengthMeters;
    return forward <= this.lengthMeters / 2 ? forward : forward - this.lengthMeters;
  }

  /** The sample `steps` samples after `index` (before it for negative steps); a closed road wraps, an open one stops at its ends. */
  stepIndex(index: number, steps: number): number {
    const count = this.pointCount;
    const next = index + steps;
    return this.closed ? ((next % count) + count) % count : Math.max(0, Math.min(count - 1, next));
  }
}

function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSquared)) : 0;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/** Uniform Catmull-Rom spline through `points`, sampled roughly every `spacing` meters. */
function sampleCatmullRom(points: readonly Point2[], closed: boolean, spacing: number): Float64Array {
  const count = points.length;
  const pointAt = (index: number): Point2 => {
    const wrapped = closed ? ((index % count) + count) % count : Math.max(0, Math.min(count - 1, index));
    return points[wrapped] ?? [0, 0];
  };
  const segments = closed ? count : count - 1;
  const samples: number[] = [];
  for (let segment = 0; segment < segments; segment++) {
    const p0 = pointAt(segment - 1);
    const p1 = pointAt(segment);
    const p2 = pointAt(segment + 1);
    const p3 = pointAt(segment + 2);
    const steps = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / spacing));
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      samples.push(catmullRom(p0[0], p1[0], p2[0], p3[0], t), catmullRom(p0[1], p1[1], p2[1], p3[1], t));
    }
  }
  if (!closed) {
    const last = pointAt(count - 1);
    samples.push(last[0], last[1]);
  }
  return Float64Array.from(samples);
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
