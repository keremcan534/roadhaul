import type { BoardTone, DirectionArrow } from '../../domain/world/roadSigns';
import { centredText, fillRect, polygon, type PixelRect } from './drawing';
import { createImage, type PixelImage, type Rgb } from './pixelImage';
import { drawText, measureText } from './strokeFont';

/**
 * The direction boards' faces (SignBoardView) in pieces: for each colour of
 * board, a row of its arrows (left, ahead, right), its digits and a plain
 * swatch of it, then a cell per place's name on it, in white capitals, two
 * to a row; and a white swatch for the boards' rims. A board's face is laid
 * out of these, so the names and distances cost one cell each however many
 * boards show them. Row 0 is the bottom (pixelImage.ts).
 */

/** A row of lettering is this many pixels tall; a name's cell this wide, an arrow's square, a digit's this wide. */
export const SIGN_BOARD_ROW_PIXELS = 48;
export const SIGN_NAME_PIXELS = 224;
export const SIGN_DIGIT_PIXELS = 28;
const SHEET_WIDTH = 2 * SIGN_NAME_PIXELS;
const SWATCH_PIXELS = 12;

/** A board colour's pieces on the sheet, in pixels. */
export interface ToneCells {
  readonly arrows: Readonly<Record<DirectionArrow, PixelRect>>;
  /** The digits 0 to 9. */
  readonly digits: readonly PixelRect[];
  /** The board's colour alone. */
  readonly plain: PixelRect;
  /** Each name's cell, by the name as written (capitals). */
  readonly names: ReadonlyMap<string, PixelRect>;
}

/** Where each piece is on the sheet. */
export interface SignBoardSheet {
  readonly width: number;
  readonly height: number;
  readonly tones: ReadonlyMap<BoardTone, ToneCells>;
  /** White, for the boards' rims. */
  readonly white: PixelRect;
}

/** The boards' colours and their lettering's. */
const TONE_COLORS: Readonly<Record<BoardTone, Rgb>> = { blue: [28, 84, 160], green: [22, 104, 60] };
const WHITE: Rgb = [244, 246, 242];
const OPAQUE = 255;

/** The sheet's layout for the names each colour of board shows (each once, whatever the order). */
export function signBoardSheet(namesByTone: ReadonlyMap<BoardTone, readonly string[]>): SignBoardSheet {
  const row = SIGN_BOARD_ROW_PIXELS;
  const tones = new Map<BoardTone, ToneCells>();
  let white: PixelRect | null = null;
  let y = 0;
  for (const [tone, names] of namesByTone) {
    const arrows = {
      left: { x: 0, y, width: row, height: row },
      ahead: { x: row, y, width: row, height: row },
      right: { x: 2 * row, y, width: row, height: row },
    };
    const digits = Array.from({ length: 10 }, (_, digit): PixelRect => ({ x: 3 * row + digit * SIGN_DIGIT_PIXELS, y, width: SIGN_DIGIT_PIXELS, height: row }));
    const plain = { x: SHEET_WIDTH - 2 * SWATCH_PIXELS, y, width: SWATCH_PIXELS, height: row };
    white ??= { x: SHEET_WIDTH - SWATCH_PIXELS, y, width: SWATCH_PIXELS, height: row };
    y += row;
    const cells = new Map<string, PixelRect>();
    [...new Set(names)].forEach((name, index) => {
      cells.set(name, { x: (index % 2) * SIGN_NAME_PIXELS, y: y + row * Math.floor(index / 2), width: SIGN_NAME_PIXELS, height: row });
    });
    y += row * Math.ceil(cells.size / 2);
    tones.set(tone, { arrows, digits, plain, names: cells });
  }
  return { width: SHEET_WIDTH, height: Math.max(row, y), tones, white: white ?? { x: 0, y: 0, width: SWATCH_PIXELS, height: row } };
}

/** The sheet drawn: each piece on its board's colour, the names left in their cells (smaller where they would not fit). */
export function signBoardImage(sheet: SignBoardSheet): PixelImage {
  const image = createImage(sheet.width, sheet.height, WHITE, OPAQUE);
  const textHeight = SIGN_BOARD_ROW_PIXELS * 0.58;
  for (const [tone, cells] of sheet.tones) {
    const color = TONE_COLORS[tone];
    for (const [name, cell] of cells.names) {
      fillRect(image, cell, color, OPAQUE);
      const fit = { height: textHeight, weight: 0.17, spacing: 0.14, slant: 0, color: WHITE };
      const room = cell.width - 12;
      const style = { ...fit, height: fit.height * Math.min(1, room / measureText(name, fit)) };
      drawText(image, name, cell.x + 6, cell.y + (cell.height - style.height) / 2, style);
    }
    for (const arrow of ['left', 'ahead', 'right'] as const) {
      fillRect(image, cells.arrows[arrow], color, OPAQUE);
      drawArrow(image, cells.arrows[arrow], arrow);
    }
    cells.digits.forEach((cell, digit) => {
      fillRect(image, cell, color, OPAQUE);
      centredText(image, String(digit), cell.x + cell.width / 2, cell.y + cell.height / 2, textHeight, WHITE, OPAQUE, 0.17);
    });
    fillRect(image, cells.plain, color, OPAQUE);
  }
  fillRect(image, sheet.white, WHITE, OPAQUE);
  return image;
}

/** An arrow in `cell` pointing `arrow`: a shaft and a head, up for ahead. */
function drawArrow(image: PixelImage, cell: PixelRect, arrow: DirectionArrow): void {
  const cx = cell.x + cell.width / 2;
  const cy = cell.y + cell.height / 2;
  // Drawn pointing up, then turned: left a quarter turn anticlockwise, right clockwise.
  const turn = arrow === 'ahead' ? 0 : arrow === 'left' ? Math.PI / 2 : -Math.PI / 2;
  const size = cell.height * 0.36;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const shaft: readonly (readonly [number, number])[] = [
    [-0.2, -1],
    [0.2, -1],
    [0.2, 0.1],
    [-0.2, 0.1],
  ];
  const head: readonly (readonly [number, number])[] = [
    [-0.7, 0.05],
    [0.7, 0.05],
    [0, 1],
  ];
  for (const part of [shaft, head]) {
    polygon(
      image,
      part.map(([x, y]) => [cx + (x * cos - y * sin) * size, cy + (x * sin + y * cos) * size] as const),
      WHITE,
      OPAQUE,
    );
  }
}
