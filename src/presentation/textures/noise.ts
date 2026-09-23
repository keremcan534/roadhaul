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
 * Value noise at (u, v) in 0..1 texture space, with `cells` lattice cells
 * across the texture. Wraps at the texture edges. Returns 0..1.
 */
export function tileableNoise(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const wrap = (i: number): number => ((i % cells) + cells) % cells;
  const a = latticeValue(wrap(x0), wrap(y0), seed);
  const b = latticeValue(wrap(x0 + 1), wrap(y0), seed);
  const c = latticeValue(wrap(x0), wrap(y0 + 1), seed);
  const d = latticeValue(wrap(x0 + 1), wrap(y0 + 1), seed);
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
