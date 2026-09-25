import { describe, expect, it } from 'vitest';
import { glassModeFor, isGlassMode, lensDisplacementPixels, lensSupported } from '../../../src/ui/glass';

const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const ANDROID_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.146 Mobile Safari/537.36';
const IOS_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IOS_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.46 Mobile/15E148 Safari/604.1';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';

describe('glass', () => {
  it('draws no filter in software or on the low preset, and bends only on high where the browser can', () => {
    expect(glassModeFor('high', true, true)).toBe('tint');
    expect(glassModeFor('low', false, true)).toBe('tint');
    expect(glassModeFor('medium', false, true)).toBe('blur');
    expect(glassModeFor('high', false, true)).toBe('lens');
    expect(glassModeFor('high', false, false)).toBe('blur');
  });

  it('knows the browsers that draw SVG filters behind elements', () => {
    expect(lensSupported(CHROME_ANDROID)).toBe(true);
    expect(lensSupported(ANDROID_WEBVIEW)).toBe(true);
    expect(lensSupported(IOS_SAFARI)).toBe(false);
    expect(lensSupported(IOS_CHROME)).toBe(false);
    expect(lensSupported(FIREFOX)).toBe(false);
  });

  it('reads the glass modes, and nothing else', () => {
    expect(isGlassMode('lens')).toBe(true);
    expect(isGlassMode('tint')).toBe(true);
    expect(isGlassMode('frosted')).toBe(false);
    expect(isGlassMode(null)).toBe(false);
  });

  describe('lens displacement map', () => {
    const size = 16;
    const pixels = lensDisplacementPixels(size, 0.25);
    const at = (column: number, row: number, channel: number): number => pixels[(row * size + column) * 4 + channel]!;

    it('leaves the middle still and opaque', () => {
      expect(at(8, 8, 0)).toBe(128);
      expect(at(8, 8, 1)).toBe(128);
      expect(at(8, 8, 3)).toBe(255);
    });

    it('reaches inward near every rim, most at the rim itself', () => {
      // Left rim: from further right; right rim: from further left.
      expect(at(0, 8, 0)).toBeGreaterThan(at(2, 8, 0));
      expect(at(2, 8, 0)).toBeGreaterThan(128);
      expect(at(15, 8, 0)).toBeLessThan(128);
      // Top row (first): from further down; bottom row: from further up.
      expect(at(8, 0, 1)).toBeGreaterThan(128);
      expect(at(8, 15, 1)).toBeLessThan(128);
      // Only along the axis across the rim.
      expect(at(0, 8, 1)).toBe(128);
      expect(at(8, 0, 0)).toBe(128);
    });

    it('bends both rims of a side alike', () => {
      for (let column = 0; column < size; column++) {
        expect(at(column, 8, 0) + at(size - 1 - column, 8, 0)).toBe(256);
      }
    });
  });
});
