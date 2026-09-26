import type { QualityLevel } from '../data/config/GameConfig';

/**
 * How the menus', panels' and road buttons' glass is drawn (styles.css keys
 * on `<html data-glass>`):
 * - `lens`: liquid glass, blurred and brightened, bending what shows through
 *   near its rim like thick glass with rounded edges;
 * - `blur`: the same without the bending;
 * - `tint`: a nearly opaque tint with the lit rim, no filter at all.
 */
export const GLASS_MODES = ['lens', 'blur', 'tint'] as const;
export type GlassMode = (typeof GLASS_MODES)[number];

export function isGlassMode(value: unknown): value is GlassMode {
  return typeof value === 'string' && (GLASS_MODES as readonly string[]).includes(value);
}

/**
 * The glass a device gets. Blurring what is behind the glass costs GPU time
 * every frame the world moves behind it: drawn in software (no GPU) or on
 * the low preset there is none, and the bending needs the high preset and a
 * Chromium browser (Chrome, Android's WebView, Edge), which alone draw SVG
 * filters behind elements.
 */
export function glassModeFor(quality: QualityLevel, software: boolean, lensSupported: boolean): GlassMode {
  if (software || quality === 'low') {
    return 'tint';
  }
  return quality === 'high' && lensSupported ? 'lens' : 'blur';
}

/** Whether the browser draws SVG filters in `backdrop-filter`: Chromium does; WebKit (all of iOS) and Firefox do not. */
export function lensSupported(userAgent: string): boolean {
  return /\bChrom(?:e|ium)\/\d+/.test(userAgent) && !/\b(?:CriOS|FxiOS|EdgiOS)\//.test(userAgent);
}

/**
 * The lens's displacement map, `size` pixels square, RGBA with the top row
 * first. Red and green say where (1 is -1, 255 is +1, 128 is still) each
 * pixel of the glass takes what shows through it from, along x and y: near
 * each border, within `edge` of the side, it reaches inward, most at the
 * rim, so the rim shows a squeezed band of what lies further in, as the
 * rounded edge of thick glass does. The middle stays still.
 */
export function lensDisplacementPixels(size: number, edge: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let row = 0; row < size; row++) {
    const y = bend((row + 0.5) / size, edge);
    for (let column = 0; column < size; column++) {
      const x = bend((column + 0.5) / size, edge);
      const index = (row * size + column) * 4;
      pixels[index] = 128 + Math.round(127 * x);
      pixels[index + 1] = 128 + Math.round(127 * y);
      pixels[index + 2] = 128;
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

/** The inward reach at `t` (0 at one border, 1 at the other): +1 at the first rim, -1 at the second, 0 beyond `edge`. */
function bend(t: number, edge: number): number {
  if (t < edge) {
    const depth = 1 - t / edge;
    return depth * depth;
  }
  if (t > 1 - edge) {
    const depth = 1 - (1 - t) / edge;
    return -depth * depth;
  }
  return 0;
}
