/** Photo mode's looks, in the order they are offered. Ids are stable (they name the strings: `photo.filter.<id>`). */
export const PHOTO_FILTER_IDS = ['natural', 'vivid', 'warm', 'cinema', 'vintage', 'mono', 'noir'] as const;
export type PhotoFilterId = (typeof PHOTO_FILTER_IDS)[number];

/** One of CSS's filter functions, with its amount (a fraction: 1 changes nothing for saturate, brightness, contrast). */
type FilterStep = readonly ['sepia' | 'grayscale' | 'saturate' | 'brightness' | 'contrast', number];

interface PhotoFilter {
  readonly steps: readonly FilterStep[];
  /** How dark the corners are drawn, 0 (none) to 1. */
  readonly vignette: number;
}

const FILTERS: Readonly<Record<PhotoFilterId, PhotoFilter>> = {
  natural: { steps: [], vignette: 0 },
  vivid: { steps: [['saturate', 1.45], ['contrast', 1.1]], vignette: 0 },
  warm: { steps: [['sepia', 0.25], ['saturate', 1.2], ['brightness', 1.03]], vignette: 0.15 },
  cinema: { steps: [['contrast', 1.18], ['saturate', 0.8], ['brightness', 0.96]], vignette: 0.45 },
  vintage: { steps: [['sepia', 0.5], ['contrast', 0.9], ['brightness', 1.06], ['saturate', 0.85]], vignette: 0.3 },
  mono: { steps: [['grayscale', 1], ['contrast', 1.12]], vignette: 0.1 },
  noir: { steps: [['grayscale', 1], ['contrast', 1.45], ['brightness', 0.9]], vignette: 0.5 },
};

/** How dark the look draws the picture's corners, 0 to 1. */
export function photoVignette(id: PhotoFilterId): number {
  return FILTERS[id].vignette;
}

/** The look as a CSS `filter` (the preview on the canvas), `none` for the natural one. */
export function photoCssFilter(id: PhotoFilterId): string {
  const steps = FILTERS[id].steps;
  return steps.length === 0 ? 'none' : steps.map(([name, amount]) => `${name}(${amount})`).join(' ');
}

/**
 * The look as one colour matrix, 3 rows of 4 (red, green, blue from the red,
 * green and blue in 0..1, and an offset), the CSS filter functions' own
 * (Filter Effects §13) one after another: the picture taken looks as the
 * preview did, in any browser.
 */
export function photoColorMatrix(id: PhotoFilterId): Float64Array {
  let matrix = identity();
  for (const [name, amount] of FILTERS[id].steps) {
    matrix = multiply(stepMatrix(name, amount), matrix);
  }
  return matrix;
}

/** Applies `matrix` (photoColorMatrix) to RGBA pixels in place; alpha stays. */
export function applyColorMatrix(pixels: Uint8ClampedArray, matrix: Float64Array): void {
  const r0 = matrix[0]!;
  const r1 = matrix[1]!;
  const r2 = matrix[2]!;
  const ro = matrix[3]! * 255;
  const g0 = matrix[4]!;
  const g1 = matrix[5]!;
  const g2 = matrix[6]!;
  const go = matrix[7]! * 255;
  const b0 = matrix[8]!;
  const b1 = matrix[9]!;
  const b2 = matrix[10]!;
  const bo = matrix[11]! * 255;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    // Uint8ClampedArray rounds and clamps what it is given.
    pixels[i] = r0 * r + r1 * g + r2 * b + ro;
    pixels[i + 1] = g0 * r + g1 * g + g2 * b + go;
    pixels[i + 2] = b0 * r + b1 * g + b2 * b + bo;
  }
}

function identity(): Float64Array {
  return Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0);
}

/** `after` applied to what `before` gives. */
function multiply(after: Float64Array, before: Float64Array): Float64Array {
  const out = new Float64Array(12);
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 4; column++) {
      let sum = column === 3 ? after[row * 4 + 3]! : 0;
      for (let k = 0; k < 3; k++) {
        sum += after[row * 4 + k]! * before[k * 4 + column]!;
      }
      out[row * 4 + column] = sum;
    }
  }
  return out;
}

function stepMatrix(name: FilterStep[0], amount: number): Float64Array {
  switch (name) {
    case 'grayscale': {
      const s = 1 - Math.min(1, amount);
      return Float64Array.of(
        0.2126 + 0.7874 * s, 0.7152 - 0.7152 * s, 0.0722 - 0.0722 * s, 0,
        0.2126 - 0.2126 * s, 0.7152 + 0.2848 * s, 0.0722 - 0.0722 * s, 0,
        0.2126 - 0.2126 * s, 0.7152 - 0.7152 * s, 0.0722 + 0.9278 * s, 0,
      );
    }
    case 'sepia': {
      const s = 1 - Math.min(1, amount);
      return Float64Array.of(
        0.393 + 0.607 * s, 0.769 - 0.769 * s, 0.189 - 0.189 * s, 0,
        0.349 - 0.349 * s, 0.686 + 0.314 * s, 0.168 - 0.168 * s, 0,
        0.272 - 0.272 * s, 0.534 - 0.534 * s, 0.131 + 0.869 * s, 0,
      );
    }
    case 'saturate':
      return Float64Array.of(
        0.213 + 0.787 * amount, 0.715 - 0.715 * amount, 0.072 - 0.072 * amount, 0,
        0.213 - 0.213 * amount, 0.715 + 0.285 * amount, 0.072 - 0.072 * amount, 0,
        0.213 - 0.213 * amount, 0.715 - 0.715 * amount, 0.072 + 0.928 * amount, 0,
      );
    case 'brightness':
      return Float64Array.of(amount, 0, 0, 0, 0, amount, 0, 0, 0, 0, amount, 0);
    case 'contrast': {
      const offset = 0.5 - 0.5 * amount;
      return Float64Array.of(amount, 0, 0, offset, 0, amount, 0, offset, 0, 0, amount, offset);
    }
  }
}
