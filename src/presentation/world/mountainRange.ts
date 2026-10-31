import { smoothstep } from '../../core/math/scalar';
import { fractalNoise } from '../textures/noise';

/**
 * The mountains round the region (MountainRidges): ranges standing off the
 * map's land edges, so the region is a valley open to the sea on its west.
 * Each ridge is a line of peaks this far past the map's edge, its back this
 * far further out; its peaks rise between low and high as the noise goes,
 * with sharper crests on broad swells; it comes down to the sea west of the
 * coast. Pure functions of the world, the same from wherever they are seen.
 */
export interface MountainRidge {
  /** How far past the map's edge the ridge's foot stands, meters. */
  readonly marginMeters: number;
  /** How far behind its foot its crest stands, meters. */
  readonly depthMeters: number;
  /** Its peaks' heights, meters: between these as the noise goes. */
  readonly lowMeters: number;
  readonly highMeters: number;
  /** The size of its swells and of its crests, meters. */
  readonly swellMeters: number;
  readonly crestMeters: number;
  readonly seed: number;
}

/** The world the ranges stand round. */
export interface MountainWorld {
  readonly halfSizeMeters: number;
  /** Where the coast meets the map's north and south edges (the westernmost of the two), x meters. */
  readonly coastX: number;
}

/** The noise repeats this far, meters: far more than the map, so it never shows. */
const NOISE_PERIOD_METERS = 64_000;

/**
 * How far from (x, z), looking along (dx, dz) (a unit direction), a ridge's
 * foot is: where the ray leaves the square `edge` meters round the map's
 * centre. From outside the square, a little way off.
 */
export function distanceToEdge(x: number, z: number, dx: number, dz: number, edge: number): number {
  let distance = Number.POSITIVE_INFINITY;
  if (dx > 1e-9) {
    distance = Math.min(distance, (edge - x) / dx);
  } else if (dx < -1e-9) {
    distance = Math.min(distance, (-edge - x) / dx);
  }
  if (dz > 1e-9) {
    distance = Math.min(distance, (edge - z) / dz);
  } else if (dz < -1e-9) {
    distance = Math.min(distance, (-edge - z) / dz);
  }
  return Math.max(distance, 30);
}

/** How high the ridge's peak over its foot at (x, z) rises, meters: 0 out at sea. */
export function ridgeHeight(ridge: MountainRidge, world: MountainWorld, x: number, z: number): number {
  const u = x / NOISE_PERIOD_METERS + 0.5;
  const v = z / NOISE_PERIOD_METERS + 0.5;
  const swellCells = Math.round(NOISE_PERIOD_METERS / ridge.swellMeters);
  const crestCells = Math.round(NOISE_PERIOD_METERS / ridge.crestMeters);
  const swell = smoothstep(0.25, 0.75, fractalNoise(u, v, swellCells, 3, ridge.seed));
  const crests = 1 - Math.abs(2 * fractalNoise(u, v, crestCells, 3, ridge.seed + 3) - 1);
  const peak = ridge.lowMeters + (ridge.highMeters - ridge.lowMeters) * (swell * 0.62 + crests * 0.38);
  // West of the coast the ranges come down into the sea as headlands, and are gone out at sea.
  return peak * smoothstep(world.coastX - 1400, world.coastX + 900, x);
}

/** A ridge's face, from its foot (0) to its crest (1): how much of its height it has reached. */
export function ridgeProfile(t: number): number {
  return t <= 0 ? -0.02 : Math.sin((t * Math.PI) / 2) ** 0.8;
}
