/**
 * Deterministic, tileable value noise for procedural textures. The same seed
 * always gives the same pattern, and every octave repeats exactly across the
 * texture, so repeated textures have no visible seams.
 */

/** A well-mixed integer hash of a lattice point, as a number in 0..1. */
function latticeValue(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Value noise at (u, v) in 0..1 texture space, with `cells` (a whole number)
 * lattice cells across the texture. Wraps at the texture edges. Returns 0..1.
 */
export function tileableNoise(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  // The lattice wraps round the texture. In whole-number arithmetic, written out here without a closure or a call:
  // the boot draws its textures through here a few million times, and a floating-point remainder in a closure made
  // this the slowest line of the boot.
  let ix = (x0 | 0) % (cells | 0);
  if (ix < 0) {
    ix += cells;
  }
  let iy = (y0 | 0) % (cells | 0);
  if (iy < 0) {
    iy += cells;
  }
  const jx = ix + 1 === cells ? 0 : ix + 1;
  const jy = iy + 1 === cells ? 0 : iy + 1;
  const a = latticeValue(ix, iy, seed);
  const b = latticeValue(jx, iy, seed);
  const c = latticeValue(ix, jy, seed);
  const d = latticeValue(jx, jy, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/**
 * Fractal noise: `octaves` layers of tileable noise, each with twice the cells
 * and half the weight of the one before. Returns 0..1.
 */
export function fractalNoise(u: number, v: number, cells: number, octaves: number, seed: number): number {
  let sum = 0;
  let weight = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave++) {
    sum += tileableNoise(u, v, cells << octave, seed + octave * 101) * weight;
    total += weight;
    weight *= 0.5;
  }
  return sum / total;
}

/** White noise per pixel (no smoothing), 0..1: grain, speckles and sparkles. */
export function grain(x: number, y: number, seed: number): number {
  return latticeValue(x, y, seed);
}
