import { describe, expect, it } from 'vitest';
import { fractalNoise, grain, tileableNoise } from '../../../../src/presentation/textures/noise';
import { createImage, type PixelImage } from '../../../../src/presentation/textures/pixelImage';
import {
  asphaltImage,
  concreteImage,
  glowImage,
  grassImage,
  lightPoolImage,
  liveryImage,
  moonImage,
  puffImage,
  officeFacadeImage,
  officeWindowLightsImage,
  rearDoorsImage,
  softShadowImage,
  warehouseWindowLightsImage,
} from '../../../../src/presentation/textures/proceduralImages';
import { drawText, hasGlyph, measureText } from '../../../../src/presentation/textures/strokeFont';
import { EN } from '../../../../src/ui/i18n/en';
import { TR } from '../../../../src/ui/i18n/tr';
import { toTexture } from '../../../../src/presentation/textures/toTexture';

const style = { height: 40, weight: 0.17, spacing: 0.12, slant: 0.16, color: [0, 0, 0] as const };

function pixel(image: PixelImage, x: number, y: number): number[] {
  const i = (y * image.width + x) * 4;
  return [...image.data.subarray(i, i + 4)];
}

describe('procedural noise', () => {
  it('is deterministic and stays within 0..1', () => {
    for (let i = 0; i < 200; i++) {
      const u = (i * 0.137) % 1;
      const v = (i * 0.311) % 1;
      const value = fractalNoise(u, v, 8, 3, 42);
      expect(value).toBe(fractalNoise(u, v, 8, 3, 42));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      expect(grain(i, i * 3, 5)).toBe(grain(i, i * 3, 5));
    }
  });

  it('tiles seamlessly: the right edge continues the left one', () => {
    for (let i = 0; i < 20; i++) {
      const v = i / 20;
      expect(tileableNoise(1, v, 8, 7)).toBeCloseTo(tileableNoise(0, v, 8, 7), 12);
      expect(fractalNoise(0.25, 1, 4, 3, 7)).toBeCloseTo(fractalNoise(0.25, 0, 4, 3, 7), 12);
    }
  });

  it('changes with the seed', () => {
    expect(fractalNoise(0.3, 0.6, 8, 3, 1)).not.toBe(fractalNoise(0.3, 0.6, 8, 3, 2));
  });
});

describe('stroke font', () => {
  it('measures longer text as wider and draws only inside its bounds', () => {
    const image = createImage(400, 80);
    const width = measureText('ROADHAUL', style);

    drawText(image, 'ROADHAUL', 10, 20, style);

    expect(width).toBeGreaterThan(measureText('ROAD', style));
    let inked = 0;
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        if (pixel(image, x, y)[0]! < 128) {
          inked++;
          expect(x).toBeGreaterThanOrEqual(10);
          expect(x).toBeLessThanOrEqual(10 + width + 2);
          expect(y).toBeGreaterThanOrEqual(20 - 4);
          expect(y).toBeLessThanOrEqual(20 + style.height + 4);
        }
      }
    }
    expect(inked).toBeGreaterThan(500);
  });

  it('has every capital of the English and Turkish alphabets, so it can write the cities\' names', () => {
    for (const letter of 'ABCÇDEFGĞHIİJKLMNOÖPQRSŞTUÜVWXYZ') {
      expect(hasGlyph(letter), letter).toBe(true);
    }
    const cityNames = [EN, TR].flatMap((table) =>
      Object.entries(table)
        .filter(([key]) => /^city\.[a-z_]+\.name$/.test(key))
        .map(([, name]) => name),
    );
    expect(cityNames.length).toBeGreaterThan(0);
    for (const name of cityNames) {
      for (const letter of name.toLocaleUpperCase('tr').replaceAll(' ', '')) {
        expect(hasGlyph(letter), `${name}: ${letter}`).toBe(true);
      }
    }
  });

  it('puts the dots and hooks of Turkish letters above the capitals and below the line', () => {
    /** The lowest and highest inked rows of `text` drawn with its baseline at y = 30. */
    const inkedRows = (text: string): [number, number] => {
      const image = createImage(120, 90);
      drawText(image, text, 10, 30, style);
      const rows: number[] = [];
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          if (pixel(image, x, y)[0]! < 128) rows.push(y);
        }
      }
      return [Math.min(...rows), Math.max(...rows)];
    };
    const [plainBottom, plainTop] = inkedRows('I');

    expect(inkedRows('İ')[1]).toBeGreaterThan(plainTop + 5);
    expect(inkedRows('Ş')[0]).toBeLessThan(plainBottom - 5);
    expect(inkedRows('Ç')[0]).toBeLessThan(plainBottom - 5);
    expect(inkedRows('Ğ')[1]).toBeGreaterThan(plainTop + 5);
    expect(inkedRows('Ö')[1]).toBeGreaterThan(plainTop + 5);
    expect(inkedRows('Ü')[1]).toBeGreaterThan(plainTop + 5);
  });

  it('renders unknown characters as spaces', () => {
    const image = createImage(200, 80);

    drawText(image, '?!', 10, 20, style);

    expect([...image.data].every((value) => value === 255)).toBe(true);
    expect(measureText('R?R', style)).toBeGreaterThan(measureText('RR', style));
  });
});

describe('procedural images', () => {
  it('are deterministic', () => {
    expect(grassImage(64).data).toEqual(grassImage(64).data);
    expect(liveryImage([224, 98, 42], 256, 128).data).toEqual(liveryImage([224, 98, 42], 256, 128).data);
  });

  it('keep grass green and asphalt dark grey', () => {
    const grass = grassImage(64);
    const asphalt = asphaltImage(64);
    let greenish = 0;
    let dark = 0;
    for (let i = 0; i < 64 * 64; i++) {
      const [r, g, b] = [grass.data[i * 4]!, grass.data[i * 4 + 1]!, grass.data[i * 4 + 2]!];
      greenish += g > r && g > b ? 1 : 0;
      dark += asphalt.data[i * 4]! < 110 ? 1 : 0;
    }
    expect(greenish / (64 * 64)).toBeGreaterThan(0.95);
    expect(dark / (64 * 64)).toBeGreaterThan(0.95);
  });

  it('put the company accent and the dark logo on the livery and the rear doors', () => {
    const accent = [224, 98, 42] as const;
    for (const image of [liveryImage(accent, 512, 256), rearDoorsImage(accent, 256)]) {
      let accentPixels = 0;
      let logoPixels = 0;
      for (let i = 0; i < image.width * image.height; i++) {
        const [r, g, b] = [image.data[i * 4]!, image.data[i * 4 + 1]!, image.data[i * 4 + 2]!];
        accentPixels += r === accent[0] && g === accent[1] && b === accent[2] ? 1 : 0;
        logoPixels += r === 44 && g === 52 && b === 64 ? 1 : 0;
      }
      expect(accentPixels).toBeGreaterThan(image.width * image.height * 0.03);
      expect(logoPixels).toBeGreaterThan(200);
    }
  });

  it('lay pale concrete slabs with darker joints', () => {
    const concrete = concreteImage(64);
    const slab = pixel(concrete, 16, 16);
    const joint = pixel(concrete, 0, 16);

    expect(slab[0]!).toBeGreaterThan(120);
    expect(joint[0]!).toBeLessThan(slab[0]! * 0.8);
    // Neutral grey: no channel far from the others.
    expect(Math.abs(slab[0]! - slab[2]!)).toBeLessThan(20);
  });

  it('draw window glass on the office facade', () => {
    const facade = officeFacadeImage(128);

    // Lower-left window, beside its centre mullion: dark glass, not wall.
    const [r, g, b] = pixel(facade, 24, 36);
    expect(r! + g! + b!).toBeLessThan(3 * 140);
    // Wall between windows stays light.
    const [wr, wg, wb] = pixel(facade, 64, 20);
    expect(wr! + wg! + wb!).toBeGreaterThan(3 * 180);
  });

  it('light about half the office windows at night, and nothing between them', () => {
    const tiles = 4;
    const tileSize = 64;
    const lights = officeWindowLightsImage(tiles, tileSize);
    const cell = tileSize / 2; // A window per cell: two bays by two floors a tile, as on the facade.
    let lit = 0;
    for (let row = 0; row < tiles * 2; row++) {
      for (let column = 0; column < tiles * 2; column++) {
        const [r, g, b] = pixel(lights, column * cell + cell / 2, row * cell + Math.round(cell * 0.55));
        if (r! + g! + b! > 0) {
          lit++;
          expect(r!).toBeGreaterThan(b!); // Warm light.
        }
        // The wall beside and under each window stays dark.
        expect(pixel(lights, column * cell + 2, row * cell + cell / 2).slice(0, 3)).toEqual([0, 0, 0]);
        expect(pixel(lights, column * cell + cell / 2, row * cell + 3).slice(0, 3)).toEqual([0, 0, 0]);
      }
    }
    expect(lit / (tiles * tiles * 4)).toBeGreaterThan(0.3);
    expect(lit / (tiles * tiles * 4)).toBeLessThan(0.7);
  });

  it('light some of the warehouses\' high windows at night, and only those', () => {
    const lights = warehouseWindowLightsImage(4, 64);
    let lit = 0;
    for (let y = 0; y < lights.height; y++) {
      for (let x = 0; x < lights.width; x++) {
        const [r, g, b] = pixel(lights, x, y);
        if (r! + g! + b! > 0) {
          lit++;
          const upTheTile = (y % 64) / 64;
          expect(upTheTile).toBeGreaterThanOrEqual(0.79);
          expect(upTheTile).toBeLessThan(0.91);
        }
      }
    }
    expect(lit).toBeGreaterThan(0);
  });

  it('glow brightest in the middle, fading to nothing at the edge', () => {
    const glow = glowImage(32);

    expect(pixel(glow, 16, 16)).toEqual([255, 255, 255, 255]);
    expect(pixel(glow, 0, 16)[3]).toBeLessThan(5);
    expect(pixel(glow, 0, 0)[3]).toBe(0);
    for (let x = 17; x < 31; x++) {
      expect(pixel(glow, x + 1, 16)[3]).toBeLessThanOrEqual(pixel(glow, x, 16)[3]!);
    }
  });

  it('light a street lamp\'s pool most under the lamp, fading smoothly to nothing at the rim', () => {
    const pool = lightPoolImage(32);

    expect(pixel(pool, 16, 16)[3]).toBeGreaterThan(245);
    expect(pixel(pool, 0, 16)[3]).toBe(0);
    expect(pixel(pool, 0, 0)[3]).toBe(0);
    for (let x = 16; x < 31; x++) {
      expect(pixel(pool, x + 1, 16)[3]).toBeLessThanOrEqual(pixel(pool, x, 16)[3]!);
    }
  });

  it('draw the moon as a pale disc with darker seas, its corners see-through without a dark fringe', () => {
    const moon = moonImage(32);
    const disc: number[] = [];
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        if (Math.hypot(x + 0.5 - 16, y + 0.5 - 16) < 13) {
          const [r, g, b, a] = pixel(moon, x, y);
          expect(a).toBe(255);
          disc.push(r! + g! + b!);
        }
      }
    }
    // Highlands and seas: bright, with some clearly darker ground.
    expect(Math.max(...disc)).toBeGreaterThan(3 * 215);
    expect(Math.min(...disc)).toBeLessThan(Math.max(...disc) * 0.85);
    // The corners are transparent, in the highlands' colour.
    const corner = pixel(moon, 0, 0);
    expect(corner[3]).toBe(0);
    expect(corner[0]).toBeGreaterThan(200);
    expect(moonImage(32)).toEqual(moon);
  });

  it('draw a puff as a soft, lumpy white cloud, clear at the edges', () => {
    const puff = puffImage(32);

    expect(pixel(puff, 16, 16)[3]).toBeGreaterThan(150);
    expect(pixel(puff, 0, 16)[3]).toBe(0);
    expect(pixel(puff, 0, 0)[3]).toBe(0);
    expect(pixel(puff, 16, 16).slice(0, 3)).toEqual([255, 255, 255]);
    // Lumpy: a ring halfway out is not all the same.
    const ring = Array.from({ length: 16 }, (_, i) => {
      const angle = (i / 16) * Math.PI * 2;
      return pixel(puff, Math.round(16 + Math.cos(angle) * 7), Math.round(16 + Math.sin(angle) * 7))[3]!;
    });
    expect(Math.max(...ring) - Math.min(...ring)).toBeGreaterThan(10);
  });

  it('fade the soft shadow from the centre to transparent edges', () => {
    const shadow = softShadowImage(32);

    expect(pixel(shadow, 16, 16)[3]).toBeGreaterThan(200);
    expect(pixel(shadow, 0, 0)[3]).toBe(0);
    expect(pixel(shadow, 31, 16)[3]).toBeLessThan(10);
  });

  it('upload as mipmapped textures, tiled or clamped', () => {
    const tiled = toTexture(grassImage(32), { repeat: true, anisotropy: 4 });
    const clamped = toTexture(softShadowImage(16), { srgb: false });

    expect(tiled.generateMipmaps).toBe(true);
    expect(tiled.anisotropy).toBe(4);
    expect(tiled.wrapS).not.toBe(clamped.wrapS);
    expect(tiled.colorSpace).not.toBe(clamped.colorSpace);
    tiled.dispose();
    clamped.dispose();
  });
});
