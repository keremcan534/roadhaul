import { describe, expect, it } from 'vitest';
import {
  applyColorMatrix,
  PHOTO_FILTER_IDS,
  photoColorMatrix,
  photoCssFilter,
  photoVignette,
} from '../../../../src/ui/photo/photoFilters';
import { photoFileName } from '../../../../src/ui/photo/photoFileName';

function filtered(id: (typeof PHOTO_FILTER_IDS)[number], r: number, g: number, b: number): number[] {
  const pixels = Uint8ClampedArray.of(r, g, b, 200);
  applyColorMatrix(pixels, photoColorMatrix(id));
  return [...pixels];
}

describe('photo filters', () => {
  it('leaves the picture alone in the natural look', () => {
    expect(photoCssFilter('natural')).toBe('none');
    expect(photoVignette('natural')).toBe(0);
    expect(filtered('natural', 12, 130, 250)).toEqual([12, 130, 250, 200]);
  });

  it('names each look as CSS draws it, the preview', () => {
    expect(photoCssFilter('noir')).toBe('grayscale(1) contrast(1.45) brightness(0.9)');
    for (const id of PHOTO_FILTER_IDS) {
      expect(photoCssFilter(id)).toMatch(/^(none|((sepia|grayscale|saturate|brightness|contrast)\([\d.]+\) ?)+)$/);
      expect(photoVignette(id)).toBeGreaterThanOrEqual(0);
      expect(photoVignette(id)).toBeLessThanOrEqual(1);
    }
  });

  it('takes the colour out in black and white, alpha kept', () => {
    for (const id of ['mono', 'noir'] as const) {
      const [r, g, b, a] = filtered(id, 220, 40, 90);
      expect(Math.abs(r! - g!)).toBeLessThanOrEqual(1);
      expect(Math.abs(g! - b!)).toBeLessThanOrEqual(1);
      expect(a).toBe(200);
    }
  });

  it('applies the filter functions one after another, as CSS does: contrast round the middle grey', () => {
    // Grey stays grey under grayscale; contrast 1.12 leaves 50 % grey where it is.
    expect(filtered('mono', 128, 128, 128).slice(0, 3).every((value) => Math.abs(value - 128) <= 1)).toBe(true);
    // Vivid: a red gets redder, its green and blue lower.
    const [r, g, b] = filtered('vivid', 200, 100, 100);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(100);
    expect(b).toBeLessThan(100);
    // Warm: blue goes down against red.
    const [warmR, , warmB] = filtered('warm', 128, 128, 128);
    expect(warmR! - warmB!).toBeGreaterThan(10);
    // White and black stay in range.
    for (const id of PHOTO_FILTER_IDS) {
      const out = filtered(id, 255, 255, 255).concat(filtered(id, 0, 0, 0));
      expect(out.every((value) => value >= 0 && value <= 255)).toBe(true);
    }
  });

  it('names a picture by when it was taken', () => {
    expect(photoFileName(new Date(2026, 10, 1, 9, 5, 7))).toBe('roadhaul-20261101-090507.jpg');
  });
});
