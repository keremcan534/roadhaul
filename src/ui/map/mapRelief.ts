import type { MapRelief } from './mapSketch';

/**
 * The 2D maps' relief: how high the ground of a region (MapRelief) stands
 * at a point, and its colour there, lit from the north-west. Pure, DOM-free
 * and allocation-free; MapTerrainImage draws a region's land with it once.
 *
 * - Inside its square the ground rolls a little (ROLL_METERS, in swells a
 *   kilometre or two across) and rises into its map's hills (a smooth dome
 *   each, as the 3D world's).
 * - Past the square the mountains round it rise (the 3D backdrop's ranges
 *   stand there): from a wandering foot round it (its corners rounded) to a
 *   crest MOUNTAIN_CREST_METERS out, then
 *   down toward the coast, their peaks between MOUNTAIN_LOW_METERS and
 *   MOUNTAIN_HIGH_METERS as the noise goes, sharp-crested.
 */

/** The rolling ground inside the square: this high either way, meters, in swells this wide. */
const ROLL_METERS = 22;
const ROLL_WAVE_METERS = 1800;
/** How far past the square's edge the mountains' crest stands, and how far the range reaches in all, meters. */
const MOUNTAIN_CREST_METERS = 1800;
const MOUNTAIN_REACH_METERS = 3400;
const MOUNTAIN_LOW_METERS = 300;
const MOUNTAIN_HIGH_METERS = 1050;
/** Along the coast the ranges come and go: in stretches this long some stand high, some are low hills down to the sea. */
const RANGE_WAVE_METERS = 6500;
/** The mountains' foot: round the square, its corners rounded as a superellipse of this power, wandering this far in and out over this wide. */
const FOOT_ROUNDNESS = 5;
const FOOT_WANDER_METERS = 520;
const FOOT_WAVE_METERS = 2600;
/** The ranges' swells and their crests, meters across. */
const MOUNTAIN_SWELL_METERS = 5200;
const MOUNTAIN_CREST_WAVE_METERS = 900;
/** Heights are exaggerated this much for the light: a map's hills read at a glance. */
const RELIEF_EXAGGERATION = 1.7;
/** However a slope faces, it keeps this much of the light: shade, never black. */
const AMBIENT_LIGHT = 0.42;
/** The light, from the north-west and 45° up (x, z on the map; y up), normalised. */
const LIGHT_X = -0.5;
const LIGHT_Z = -0.5;
const LIGHT_Y = Math.SQRT1_2;

/** How high the ground stands at (x, z), meters (in the map's meters, where the relief's square is). */
export function reliefHeight(relief: MapRelief, x: number, z: number): number {
  const half = relief.halfSizeMeters;
  const localX = x - relief.x;
  const localZ = z - relief.z;
  const seed = relief.seed;
  let height = 0;
  for (let i = 0; i < relief.hills.length; i++) {
    const hill = relief.hills[i]!;
    const d = Math.hypot(x - hill.x, z - hill.z) / hill.radiusMeters;
    if (d < 1) {
      const fall = 1 - d * d;
      height += hill.heightMeters * fall * fall;
    }
  }
  // How far past the mountains' foot, meters: round the square with its corners rounded, the foot wandering in and
  // out (FOOT_WANDER_METERS), so no straight edge or corner of the square shows.
  const ax = Math.abs(localX) / half;
  const az = Math.abs(localZ) / half;
  const rounded = (ax ** FOOT_ROUNDNESS + az ** FOOT_ROUNDNESS) ** (1 / FOOT_ROUNDNESS) * half;
  const foot = FOOT_WANDER_METERS * (2 * fbm(x / FOOT_WAVE_METERS - 7.7, z / FOOT_WAVE_METERS + 5.3, 3, seed + 53) - 1);
  const outside = rounded - half - foot;
  const roll = ROLL_METERS * (2 * fbm(x / ROLL_WAVE_METERS, z / ROLL_WAVE_METERS, 3, seed) - 1);
  if (outside <= 0) {
    return height + roll;
  }
  // The mountains: up from the square's edge to the crest, then down toward the coast.
  const rise = outside < MOUNTAIN_CREST_METERS ? smooth(outside / MOUNTAIN_CREST_METERS) : 1 - 0.55 * smooth((outside - MOUNTAIN_CREST_METERS) / (MOUNTAIN_REACH_METERS - MOUNTAIN_CREST_METERS));
  const swell = fbm(x / MOUNTAIN_SWELL_METERS + 11.3, z / MOUNTAIN_SWELL_METERS - 4.1, 3, seed + 17);
  const crest = 1 - Math.abs(2 * fbm(x / MOUNTAIN_CREST_WAVE_METERS - 2.7, z / MOUNTAIN_CREST_WAVE_METERS + 8.9, 4, seed + 29) - 1);
  const peak = MOUNTAIN_LOW_METERS + (MOUNTAIN_HIGH_METERS - MOUNTAIN_LOW_METERS) * (0.6 * swell + 0.4 * crest);
  const range = 0.18 + 0.82 * smooth(fbm(x / RANGE_WAVE_METERS + 21.1, z / RANGE_WAVE_METERS - 13.4, 2, seed + 67) * 1.9 - 0.45);
  return height + roll + peak * rise * range;
}

/**
 * How the light falls on ground whose height rises `dx` meters a meter east
 * and `dz` a meter south: AMBIENT_LIGHT (in shade) to about 1.3 (facing the
 * light), 1 on the flat.
 */
export function reliefLight(dx: number, dz: number): number {
  const nx = -dx * RELIEF_EXAGGERATION;
  const nz = -dz * RELIEF_EXAGGERATION;
  const length = Math.hypot(nx, 1, nz);
  const lit = Math.max(0, (nx * LIGHT_X + LIGHT_Y + nz * LIGHT_Z) / length) / LIGHT_Y;
  return AMBIENT_LIGHT + (1 - AMBIENT_LIGHT) * lit;
}

/**
 * The ground's colour at `height` meters with `steepness` (rise per meter),
 * `variety` 0..1 (the meadows' patches) and lit by `light` (reliefLight),
 * written as RGB 0..255 into `out` at `offset`. Meadow greens on the low
 * ground, heath and rock up the mountains, snow on their tops.
 */
export function reliefColor(height: number, steepness: number, variety: number, light: number, out: Uint8ClampedArray, offset: number): void {
  // Meadow: two greens by the patches.
  let r = 74 + (96 - 74) * variety;
  let g = 107 + (124 - 107) * variety;
  let b = 63 + (70 - 63) * variety;
  // Heath and moor up the slopes.
  const heath = smooth((height - 260) / 300);
  r += (118 - r) * heath * 0.7;
  g += (112 - g) * heath * 0.7;
  b += (78 - b) * heath * 0.7;
  // Rock where it is high or steep.
  const rock = Math.min(1, smooth((height - 560) / 260) + smooth((steepness - 0.35) / 0.4) * 0.6);
  r += (128 - r) * rock;
  g += (122 - g) * rock;
  b += (112 - b) * rock;
  // Snow on the tops.
  const snow = smooth((height - 860) / 160);
  r += (236 - r) * snow;
  g += (240 - g) * snow;
  b += (244 - b) * snow;
  out[offset] = r * light;
  out[offset + 1] = g * light;
  out[offset + 2] = b * light;
}

/** The meadows' patches at (x, z): 0..1, in patches a few hundred meters across. */
export function reliefVariety(relief: MapRelief, x: number, z: number): number {
  return smooth(fbm(x / 650 + 3.3, z / 650 - 1.9, 3, relief.seed + 41) * 1.6 - 0.3);
}

/** 0..1 eased: 0 below 0, 1 above 1. */
function smooth(t: number): number {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Smooth value noise summed over `octaves`, 0..1. */
function fbm(x: number, z: number, octaves: number, seed: number): number {
  let sum = 0;
  let weight = 1;
  let total = 0;
  let scale = 1;
  for (let octave = 0; octave < octaves; octave++) {
    sum += valueNoise(x * scale, z * scale, seed + octave * 101) * weight;
    total += weight;
    weight *= 0.5;
    scale *= 2;
  }
  return sum / total;
}

/** Value noise on a unit lattice, smoothly interpolated, 0..1. */
function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = lattice(x0, z0, seed);
  const b = lattice(x0 + 1, z0, seed);
  const c = lattice(x0, z0 + 1, seed);
  const d = lattice(x0 + 1, z0 + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** A lattice point's value, 0..1: the same each time. */
function lattice(x: number, z: number, seed: number): number {
  const value = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
}
