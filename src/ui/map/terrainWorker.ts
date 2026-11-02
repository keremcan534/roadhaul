import { reliefColor, reliefHeight, reliefLight, reliefVariety } from './mapRelief';
import type { MapRelief } from './mapSketch';

/** What MapTerrainImage asks for: a region's relief drawn over a grid of cells, `cell` meters each. */
export interface TerrainRequest {
  readonly id: number;
  readonly relief: MapRelief;
  readonly minX: number;
  readonly minZ: number;
  readonly cell: number;
  readonly width: number;
  readonly height: number;
}

/** The answer: its pixels, RGBA, row by row from the north-west. */
export interface TerrainAnswer {
  readonly id: number;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * Draws the relief of a region's land (mapRelief.ts) off the main thread:
 * the heights of every cell's corner first, then each cell's colour, lit by
 * the slope round it. A few hundred thousand cells: a second or two on a
 * low-end phone, with no frame waiting for it.
 */
export function drawTerrain(request: TerrainRequest): Uint8ClampedArray<ArrayBuffer> {
  const { relief, minX, minZ, cell, width, height } = request;
  // Heights at the cells' middles, one cell round the edge more for the slopes there.
  const columns = width + 2;
  const heights = new Float32Array(columns * (height + 2));
  for (let row = 0; row < height + 2; row++) {
    const z = minZ + (row - 0.5) * cell;
    for (let column = 0; column < columns; column++) {
      heights[row * columns + column] = reliefHeight(relief, minX + (column - 0.5) * cell, z);
    }
  }
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const z = minZ + (row + 0.5) * cell;
    for (let column = 0; column < width; column++) {
      const at = (row + 1) * columns + column + 1;
      const dx = (heights[at + 1]! - heights[at - 1]!) / (2 * cell);
      const dz = (heights[at + columns]! - heights[at - columns]!) / (2 * cell);
      const offset = (row * width + column) * 4;
      const x = minX + (column + 0.5) * cell;
      reliefColor(heights[at]!, Math.hypot(dx, dz), reliefVariety(relief, x, z), reliefLight(dx, dz), pixels, offset);
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

// As a worker: each request answered with its pixels, handed over (not copied).
const scope = globalThis as unknown as {
  onmessage: ((event: { data: TerrainRequest }) => void) | null;
  postMessage(message: TerrainAnswer, transfer: ArrayBuffer[]): void;
  document?: unknown;
};
if (scope.document === undefined && typeof scope.postMessage === 'function') {
  scope.onmessage = (event) => {
    const request = event.data;
    const pixels = drawTerrain(request);
    scope.postMessage({ id: request.id, width: request.width, height: request.height, pixels }, [pixels.buffer]);
  };
}
