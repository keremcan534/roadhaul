import { DataTexture, LinearFilter, RedFormat, UnsignedByteType, Vector4 } from 'three';
import type { RiverPath } from '../../domain/world/RiverPath';

/** A river flows in from this far beyond the map's edge, meters, sampled this often, so its source is never seen. */
const SOURCE_REACH_METERS = 900;
const SOURCE_STEP_METERS = 15;
/** The channel mask's texels are this far apart, meters. */
const MASK_TEXEL_METERS = 4;
/**
 * The ground is cut open this far inside a channel's rim, meters: it always
 * overlaps the top of the banks, so no crack opens between them.
 */
const CUT_INSET_METERS = 1;
/**
 * Each texel holds how far its middle lies from the cut's edge (out
 * positive), up to this far either way, meters, in steps of 1 / this: the
 * texture's filtering finds the edge between texels.
 */
const MASK_REACH_METERS = 15;
const MASK_STEPS_PER_METER = 8;
/**
 * Where a channel ends on land (its source, beyond the map's edge), the cut
 * stops this many samples short of the channel's end: the ground closes over
 * it there, so no gap opens past its end.
 */
const CLOSED_END_SAMPLES = 2;

/** A point of a river's course as drawn: where, which way it flows, how deep, and how far along. */
export interface CoursePoint {
  readonly x: number;
  readonly z: number;
  readonly dx: number;
  readonly dz: number;
  readonly depth: number;
  readonly along: number;
}

/**
 * The river's course as drawn: from SOURCE_REACH_METERS beyond its source
 * (it flows in from off the map) to its mouth, the first sample in the sea,
 * or as far past its end when it never reaches the sea.
 */
export function riverCourse(river: RiverPath): CoursePoint[] {
  const course: CoursePoint[] = [];
  const count = river.pointCount;
  const end = Math.min(river.mouthIndex, count - 1);
  const head = { dx: river.directionX(0), dz: river.directionZ(0) };
  for (let back = SOURCE_REACH_METERS; back > 0; back -= SOURCE_STEP_METERS) {
    course.push({ x: river.x(0) - head.dx * back, z: river.z(0) - head.dz * back, ...head, depth: 1, along: -back });
  }
  for (let i = 0; i <= end; i++) {
    course.push({
      x: river.x(i),
      z: river.z(i),
      dx: river.directionX(i),
      dz: river.directionZ(i),
      depth: river.depths[i]!,
      along: river.distances[i]!,
    });
  }
  if (river.mouthIndex >= count) {
    const tail = { dx: river.directionX(count - 1), dz: river.directionZ(count - 1) };
    for (let on = SOURCE_STEP_METERS; on <= SOURCE_REACH_METERS; on += SOURCE_STEP_METERS) {
      const last = river.lengthMeters;
      course.push({ x: river.x(count - 1) + tail.dx * on, z: river.z(count - 1) + tail.dz * on, ...tail, depth: 1, along: last + on });
    }
  }
  return course;
}

/** Where the ground is cut open for the rivers' channels (see createChannelMask). */
export interface ChannelMask {
  /** One channel, 8 bits a texel, filtered: under 0.5 where the ground is cut. */
  readonly texture: DataTexture;
  /** Where it lies: at world (x, z) its uv is ((x - frame.x) * frame.z, (z - frame.y) * frame.w). */
  readonly frame: Vector4;
}

/**
 * Where the ground plane is cut open over the rivers' channels (their
 * courses as drawn), so their banks and water, lying below the fields, show
 * through: a hair (CUT_INSET_METERS) inside each rim. A small texture over
 * the rivers' extent, holding how far each texel lies from the cut's edge,
 * so the edge follows the channel smoothly between texels. The ground's
 * shader leaves out what lies under 0.5 (TrackView). Where a river flows
 * into the sea the cut runs on under the sea; where its channel ends on
 * land it stops short, under the ground. Null for no rivers. The caller
 * disposes the texture.
 */
export function createChannelMask(rivers: readonly RiverPath[]): ChannelMask | null {
  const cuts = rivers.map((river) => {
    const course = riverCourse(river);
    const intoSea = river.mouthIndex < river.pointCount;
    return {
      course,
      from: CLOSED_END_SAMPLES,
      to: course.length - 1 - (intoSea ? 0 : CLOSED_END_SAMPLES),
      closedEnd: !intoSea,
      halfWidth: river.openingHalfWidthMeters - CUT_INSET_METERS,
    };
  });
  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const cut of cuts) {
    const reach = cut.halfWidth + MASK_REACH_METERS + MASK_TEXEL_METERS * 2;
    for (let i = cut.from; i <= cut.to; i++) {
      const point = cut.course[i]!;
      minX = Math.min(minX, point.x - reach);
      minZ = Math.min(minZ, point.z - reach);
      maxX = Math.max(maxX, point.x + reach);
      maxZ = Math.max(maxZ, point.z + reach);
    }
  }
  if (!(minX < maxX)) {
    return null;
  }
  // A width of whole 4-texel rows, so the rows upload unpadded either way.
  const width = Math.ceil((maxX - minX) / MASK_TEXEL_METERS / 4) * 4;
  const height = Math.ceil((maxZ - minZ) / MASK_TEXEL_METERS);
  const data = new Uint8Array(width * height).fill(255);
  for (const cut of cuts) {
    const reach = cut.halfWidth + MASK_REACH_METERS;
    for (let i = cut.from; i < cut.to; i++) {
      const a = cut.course[i]!;
      const b = cut.course[i + 1]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lengthSquared = dx * dx + dz * dz || 1;
      // Squared off at the ends that close under the ground, rounded everywhere else.
      const squareStart = i === cut.from;
      const squareEnd = cut.closedEnd && i === cut.to - 1;
      const fromColumn = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach - minX) / MASK_TEXEL_METERS));
      const toColumn = Math.min(width - 1, Math.ceil((Math.max(a.x, b.x) + reach - minX) / MASK_TEXEL_METERS));
      const fromRow = Math.max(0, Math.floor((Math.min(a.z, b.z) - reach - minZ) / MASK_TEXEL_METERS));
      const toRow = Math.min(height - 1, Math.ceil((Math.max(a.z, b.z) + reach - minZ) / MASK_TEXEL_METERS));
      for (let row = fromRow; row <= toRow; row++) {
        const z = minZ + (row + 0.5) * MASK_TEXEL_METERS;
        for (let column = fromColumn; column <= toColumn; column++) {
          const x = minX + (column + 0.5) * MASK_TEXEL_METERS;
          const along = ((x - a.x) * dx + (z - a.z) * dz) / lengthSquared;
          if ((squareStart && along < 0) || (squareEnd && along > 1)) {
            continue;
          }
          const t = Math.max(0, Math.min(1, along));
          const offX = x - (a.x + dx * t);
          const offZ = z - (a.z + dz * t);
          const out = Math.sqrt(offX * offX + offZ * offZ) - cut.halfWidth;
          const value = Math.max(0, Math.min(255, Math.round(127.5 + out * MASK_STEPS_PER_METER)));
          const index = row * width + column;
          if (value < data[index]!) {
            data[index] = value;
          }
        }
      }
    }
  }
  const texture = new DataTexture(data, width, height, RedFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  const frame = new Vector4(minX, minZ, 1 / (width * MASK_TEXEL_METERS), 1 / (height * MASK_TEXEL_METERS));
  return { texture, frame };
}
