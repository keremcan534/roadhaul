import { describe, expect, it } from 'vitest';
import { reliefColor, reliefHeight, reliefLight } from '../../../../src/ui/map/mapRelief';
import type { MapRelief } from '../../../../src/ui/map/mapSketch';
import { drawTerrain } from '../../../../src/ui/map/terrainWorker';

const relief: MapRelief = { x: 0, z: 0, halfSizeMeters: 3000, hills: [{ x: 1000, z: 1000, radiusMeters: 800, heightMeters: 200 }], seed: 7 };

describe('mapRelief', () => {
  it('rolls a little inside the square, rises into its hills, and into mountains past it', () => {
    let inside = 0;
    // Well inside the square (its edges and corners are the mountains' foot, wandering).
    for (let x = -2200; x <= 2200; x += 400) {
      for (let z = -2200; z <= 0; z += 400) {
        inside = Math.max(inside, Math.abs(reliefHeight(relief, x, z)));
      }
    }
    // Away from the hill, the ground keeps within the roll.
    expect(inside).toBeLessThanOrEqual(22);
    expect(reliefHeight(relief, 1000, 1000)).toBeGreaterThan(170);
    // Past the edge, the ranges stand up to hundreds of meters high, higher toward their crest than at their foot.
    const crests = [-2000, -1000, 0, 1000, 2000].map((z) => reliefHeight(relief, 3000 + 1800, z));
    expect(Math.max(...crests)).toBeGreaterThan(200);
    expect(reliefHeight(relief, 3000 - 600, 0)).toBeLessThan(Math.max(...crests));
    // The same every time.
    expect(reliefHeight(relief, 4321, -1234)).toBe(reliefHeight({ ...relief }, 4321, -1234));
  });

  it('lights slopes facing the north-west and shades the others, the flat as it is', () => {
    expect(reliefLight(0, 0)).toBeCloseTo(1, 6);
    // Rising toward the south-east: facing the north-west light.
    expect(reliefLight(0.2, 0.2)).toBeGreaterThan(1);
    expect(reliefLight(-0.2, -0.2)).toBeLessThan(1);
    // In the deepest shade, never black.
    expect(reliefLight(-5, -5)).toBeGreaterThan(0.4);
  });

  it('colours meadows green, and the mountains\' tops white', () => {
    const out = new Uint8ClampedArray(8);
    reliefColor(10, 0.01, 0.5, 1, out, 0);
    reliefColor(1100, 0.1, 0.5, 1, out, 4);
    expect(out[1]!).toBeGreaterThan(out[0]!);
    expect(out[1]!).toBeGreaterThan(out[2]!);
    expect(Math.min(out[4]!, out[5]!, out[6]!)).toBeGreaterThan(200);
  });

  it('draws a land\'s relief into opaque pixels, row by row', () => {
    const pixels = drawTerrain({ id: 0, relief, minX: -3500, minZ: -500, cell: 100, width: 12, height: 6 });
    expect(pixels).toHaveLength(12 * 6 * 4);
    for (let i = 3; i < pixels.length; i += 4) {
      expect(pixels[i]).toBe(255);
    }
    // The mountains west of the square are lighter or darker than the meadow inside it: the relief shows.
    const west = pixels[(2 * 12 + 1) * 4 + 1]!;
    const meadow = pixels[(2 * 12 + 10) * 4 + 1]!;
    expect(west).not.toBe(meadow);
  });
});
