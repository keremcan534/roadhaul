import { describe, expect, it } from 'vitest';
import type { PixelRect } from '../../../../src/presentation/textures/drawing';
import type { PixelImage } from '../../../../src/presentation/textures/pixelImage';
import { SIGN_BOARD_ROW_PIXELS, signBoardImage, signBoardSheet } from '../../../../src/presentation/textures/signBoardImages';

function pixel(image: PixelImage, x: number, y: number): number[] {
  const i = (Math.round(y) * image.width + Math.round(x)) * 4;
  return [...image.data.subarray(i, i + 4)];
}

/** Whether any pixel of `rect` is white lettering, stepping `step` pixels. */
function lettered(image: PixelImage, rect: PixelRect, step = 1): boolean {
  for (let y = rect.y; y < rect.y + rect.height; y += step) {
    for (let x = rect.x; x < rect.x + rect.width; x += step) {
      const [r, g, b] = pixel(image, x, y);
      if (r! > 230 && g! > 230 && b! > 230) {
        return true;
      }
    }
  }
  return false;
}

describe('signBoardImages', () => {
  const sheet = signBoardSheet(
    new Map([
      ['blue', ['HAVENPORT', 'REEDMILL', 'HAVENPORT', 'IRONFORD']],
      ['green', ['IRONFORD']],
    ] as const),
  );
  const image = signBoardImage(sheet);

  it('lays each colour of board out once: its arrows, digits and swatch, then each name once, two to a row', () => {
    const blue = sheet.tones.get('blue')!;
    const green = sheet.tones.get('green')!;
    expect([...blue.names.keys()]).toEqual(['HAVENPORT', 'REEDMILL', 'IRONFORD']);
    expect([...green.names.keys()]).toEqual(['IRONFORD']);
    expect(sheet.height).toBe(SIGN_BOARD_ROW_PIXELS * (1 + 2 + 1 + 1));
    expect(image.width).toBe(sheet.width);
    expect(image.height).toBe(sheet.height);
    const cells: PixelRect[] = [
      ...[blue, green].flatMap((tone) => [...Object.values(tone.arrows), ...tone.digits, tone.plain, ...tone.names.values()]),
      sheet.white,
    ];
    for (const [index, cell] of cells.entries()) {
      expect(cell.x + cell.width).toBeLessThanOrEqual(sheet.width);
      expect(cell.y + cell.height).toBeLessThanOrEqual(sheet.height);
      for (const other of cells.slice(index + 1)) {
        const apart =
          cell.x + cell.width <= other.x || other.x + other.width <= cell.x || cell.y + cell.height <= other.y || other.y + other.height <= cell.y;
        expect(apart).toBe(true);
      }
    }
  });

  it('writes the names, arrows and digits in white on the board\'s colour; its swatch is the colour alone', () => {
    const blue = sheet.tones.get('blue')!;
    const green = sheet.tones.get('green')!;
    for (const cell of [...blue.names.values(), ...Object.values(blue.arrows), ...blue.digits, ...green.names.values()]) {
      expect(lettered(image, cell)).toBe(true);
    }
    expect(lettered(image, blue.plain)).toBe(false);
    const [r, g, b] = pixel(image, blue.plain.x + 2, blue.plain.y + 2);
    expect(b).toBeGreaterThan(r! + 60);
    expect(b).toBeGreaterThan(g!);
    const [gr, gg, gb] = pixel(image, green.plain.x + 2, green.plain.y + 2);
    expect(gg).toBeGreaterThan(gr! + 40);
    expect(gg).toBeGreaterThan(gb!);
    expect(pixel(image, sheet.white.x + 2, sheet.white.y + 2).slice(0, 3).every((channel) => channel > 230)).toBe(true);
  });

  it('points the arrows their ways: the left one\'s head on the left, the right one\'s on the right, ahead\'s at the top', () => {
    const { arrows } = sheet.tones.get('blue')!;
    const weight = (cell: PixelRect, part: 'left' | 'right' | 'top' | 'bottom'): number => {
      let white = 0;
      for (let y = cell.y; y < cell.y + cell.height; y++) {
        for (let x = cell.x; x < cell.x + cell.width; x++) {
          const inPart =
            part === 'left' ? x < cell.x + cell.width / 2 : part === 'right' ? x >= cell.x + cell.width / 2 : part === 'top' ? y >= cell.y + cell.height / 2 : y < cell.y + cell.height / 2;
          const [r] = pixel(image, x, y);
          white += inPart && r! > 200 ? 1 : 0;
        }
      }
      return white;
    };
    // The head is the wider part of the arrow.
    expect(weight(arrows.left, 'left')).toBeGreaterThan(weight(arrows.left, 'right'));
    expect(weight(arrows.right, 'right')).toBeGreaterThan(weight(arrows.right, 'left'));
    expect(weight(arrows.ahead, 'top')).toBeGreaterThan(weight(arrows.ahead, 'bottom'));
  });
});
