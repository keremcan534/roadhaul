import { arcBand, centredText, disc, fillRect, line, paint, roundedBox, shadeRect, type PixelRect } from './drawing';
import { grain } from './noise';
import { createImage, type PixelImage, type Rgb } from './pixelImage';

/**
 * The scenery's pictures in one atlas, so the countryside's and the towns'
 * props draw with one material (SceneryView): four billboard posters for
 * original local businesses, the speed limit signs and their backs, the bus
 * stop's sign, a dry-stone wall's face, and a white swatch for everything
 * painted by its vertex colours. Row 0 is the bottom (pixelImage.ts).
 */
export const PROP_ATLAS_WIDTH = 1024;
export const PROP_ATLAS_HEIGHT = 512;

export const PROP_ATLAS = {
  /** The billboards' posters, in the order of their `ad` number. */
  posters: [
    { x: 0, y: 384, width: 256, height: 128 },
    { x: 256, y: 384, width: 256, height: 128 },
    { x: 512, y: 384, width: 256, height: 128 },
    { x: 768, y: 384, width: 256, height: 128 },
  ],
  /** Speed limit faces: 50, 70 and 90 km/h. */
  speed50: { x: 0, y: 256, width: 128, height: 128 },
  speed70: { x: 128, y: 256, width: 128, height: 128 },
  speed90: { x: 256, y: 256, width: 128, height: 128 },
  /** A round sign's grey back. */
  signBack: { x: 384, y: 256, width: 128, height: 128 },
  /** The bus stop's sign: a bus on blue. */
  busStop: { x: 512, y: 256, width: 128, height: 128 },
  /** A dry-stone wall's face, a few meters of it across the picture. */
  stones: { x: 0, y: 128, width: 512, height: 128 },
  /** White, painted by the vertex colours. */
  plain: { x: 896, y: 16, width: 32, height: 32 },
} as const;

/** The speed limit faces the atlas has, by km/h. */
export const SPEED_LIMIT_FACES: Readonly<Record<number, PixelRect>> = {
  50: PROP_ATLAS.speed50,
  70: PROP_ATLAS.speed70,
  90: PROP_ATLAS.speed90,
};

const OPAQUE = 255;
const WHITE: Rgb = [246, 246, 242];

/** The whole atlas. Deterministic. */
export function propAtlasImage(): PixelImage {
  const image = createImage(PROP_ATLAS_WIDTH, PROP_ATLAS_HEIGHT, [128, 128, 128], OPAQUE);
  const [haul, flour, steel, fish] = PROP_ATLAS.posters;
  drawHaulagePoster(image, haul);
  drawFlourPoster(image, flour);
  drawSteelPoster(image, steel);
  drawFishPoster(image, fish);
  drawSpeedLimit(image, PROP_ATLAS.speed50, '50');
  drawSpeedLimit(image, PROP_ATLAS.speed70, '70');
  drawSpeedLimit(image, PROP_ATLAS.speed90, '90');
  drawSignBack(image, PROP_ATLAS.signBack);
  drawBusStop(image, PROP_ATLAS.busStop);
  drawStones(image, PROP_ATLAS.stones);
  fillRect(image, PROP_ATLAS.plain, [255, 255, 255], OPAQUE);
  return image;
}

/**
 * Tileable paving for the pavements: grey flagstones in staggered rows,
 * each a little lighter or darker, with dark joints. `size` pixels square.
 */
export function pavingImage(size = 128): PixelImage {
  const image = createImage(size, size);
  const rows = 4;
  const columns = 2;
  const rowHeight = size / rows;
  const stoneWidth = size / columns;
  shadeRect(image, { x: 0, y: 0, width: size, height: size }, (_u, _v, x, y, out) => {
    const row = Math.floor(y / rowHeight);
    const shift = row % 2 === 0 ? 0 : stoneWidth / 2;
    const column = Math.floor(((x + shift) % size) / stoneWidth);
    const inRowY = y - row * rowHeight;
    const inStoneX = (x + shift) % stoneWidth;
    const joint = inRowY < 2 || inStoneX < 2;
    const stone = 0.9 + 0.2 * grain(column + 7, row + 3, 211);
    const fleck = 0.94 + 0.1 * grain(x, y, 223);
    const level = joint ? 92 : 172 * stone * fleck;
    paint(out, level, level * 0.99, level * 0.97);
  }, OPAQUE);
  return image;
}

/** A poster's frame of light, the business's name, a line under it, and its picture on the right. */
function posterBase(image: PixelImage, rect: PixelRect, from: Rgb, to: Rgb): void {
  shadeRect(image, rect, (_u, v, x, y, out) => {
    const f = 0.97 + 0.05 * grain(x, y, 97);
    paint(out, (from[0] + (to[0] - from[0]) * v) * f, (from[1] + (to[1] - from[1]) * v) * f, (from[2] + (to[2] - from[2]) * v) * f);
  }, OPAQUE);
}

function drawHaulagePoster(image: PixelImage, rect: PixelRect): void {
  const { x, y } = rect;
  posterBase(image, rect, [18, 44, 96], [36, 86, 168]);
  centredText(image, 'ROADHAUL', x + 96, y + 78, 26, WHITE, OPAQUE, 0.16);
  centredText(image, 'LOJİSTİK', x + 96, y + 44, 15, [255, 170, 40], OPAQUE, 0.15);
  line(image, x + 26, y + 26, x + 166, y + 26, 3, [255, 170, 40], OPAQUE);
  // A truck: its box, cab, window and wheels, driving right.
  roundedBox(image, x + 176, y + 50, x + 222, y + 88, 3, WHITE, OPAQUE);
  roundedBox(image, x + 224, y + 50, x + 244, y + 78, 3, WHITE, OPAQUE);
  roundedBox(image, x + 229, y + 64, x + 241, y + 75, 2, [36, 86, 168], OPAQUE);
  for (const wheel of [188, 212, 236]) {
    disc(image, x + wheel, y + 48, 6, [20, 22, 26], OPAQUE);
    disc(image, x + wheel, y + 48, 2.5, [180, 186, 192], OPAQUE);
  }
}

function drawFlourPoster(image: PixelImage, rect: PixelRect): void {
  const { x, y } = rect;
  posterBase(image, rect, [236, 190, 72], [250, 226, 150]);
  centredText(image, 'BAŞAKOVA', x + 92, y + 80, 20, [110, 62, 22], OPAQUE, 0.16);
  centredText(image, 'UN', x + 92, y + 40, 30, [200, 36, 30], OPAQUE, 0.18);
  // An ear of wheat: a stalk and grains either side.
  line(image, x + 206, y + 16, x + 206, y + 100, 3, [150, 100, 30], OPAQUE);
  for (let i = 0; i < 6; i++) {
    const grainY = y + 54 + i * 9;
    for (const side of [-1, 1]) {
      line(image, x + 206, grainY, x + 206 + side * 11, grainY + 7, 6, [196, 140, 40], OPAQUE);
    }
  }
}

function drawSteelPoster(image: PixelImage, rect: PixelRect): void {
  const { x, y } = rect;
  posterBase(image, rect, [58, 64, 72], [128, 136, 146]);
  centredText(image, 'DEMİRKENT', x + 96, y + 80, 20, WHITE, OPAQUE, 0.16);
  centredText(image, 'ÇELİK', x + 96, y + 40, 28, [255, 140, 30], OPAQUE, 0.18);
  // An I-beam, end on.
  const steel: Rgb = [210, 216, 222];
  roundedBox(image, x + 186, y + 90, x + 234, y + 100, 1, steel, OPAQUE);
  roundedBox(image, x + 186, y + 24, x + 234, y + 34, 1, steel, OPAQUE);
  roundedBox(image, x + 205, y + 34, x + 215, y + 90, 1, steel, OPAQUE);
}

function drawFishPoster(image: PixelImage, rect: PixelRect): void {
  const { x, y } = rect;
  posterBase(image, rect, [16, 96, 120], [60, 170, 190]);
  centredText(image, 'YENİLİMAN', x + 92, y + 82, 19, WHITE, OPAQUE, 0.16);
  centredText(image, 'TAZE BALIK', x + 92, y + 44, 20, [255, 220, 90], OPAQUE, 0.17);
  // A fish: its body, tail, eye and fin.
  const silver: Rgb = [226, 236, 240];
  for (let i = -26; i <= 26; i++) {
    const half = 16 * Math.sqrt(1 - (i / 27) ** 2);
    line(image, x + 206 + i, y + 62 - half, x + 206 + i, y + 62 + half, 1.4, silver, OPAQUE);
  }
  for (const [ax, ay, bx, by] of [
    [232, 62, 250, 78],
    [232, 62, 250, 46],
    [250, 78, 250, 46],
  ] as const) {
    line(image, x + ax, y + ay, x + bx, y + by, 3, silver, OPAQUE);
  }
  disc(image, x + 188, y + 67, 3, [20, 40, 60], OPAQUE);
  arcBand(image, x + 200, y + 62, 9, 11, 120, 60, [150, 176, 186], OPAQUE);
}

/** A speed limit: a white disc in a red ring, the number in black. */
function drawSpeedLimit(image: PixelImage, rect: PixelRect, number: string): void {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  fillRect(image, rect, [150, 150, 150], OPAQUE);
  disc(image, cx, cy, 62, [206, 30, 32], OPAQUE);
  disc(image, cx, cy, 47, WHITE, OPAQUE);
  centredText(image, number, cx, cy, 44, [20, 20, 22], OPAQUE, 0.15);
}

/** The back of a round sign: plain grey metal with its clamp. */
function drawSignBack(image: PixelImage, rect: PixelRect): void {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  fillRect(image, rect, [150, 150, 150], OPAQUE);
  disc(image, cx, cy, 62, [120, 126, 132], OPAQUE, 'lit', [176, 182, 188]);
  roundedBox(image, cx - 7, cy - 40, cx + 7, cy + 40, 3, [96, 100, 106], OPAQUE);
}

/** The bus stop's sign: a white bus on blue, and "DURAK". */
function drawBusStop(image: PixelImage, rect: PixelRect): void {
  const { x, y } = rect;
  fillRect(image, rect, [24, 86, 170], OPAQUE);
  roundedBox(image, x + 6, y + 6, x + 122, y + 122, 10, [30, 100, 196], OPAQUE);
  roundedBox(image, x + 30, y + 52, x + 98, y + 104, 8, WHITE, OPAQUE);
  roundedBox(image, x + 36, y + 76, x + 92, y + 98, 3, [30, 100, 196], OPAQUE);
  for (const wheel of [44, 84]) {
    disc(image, x + wheel, y + 52, 7, WHITE, OPAQUE);
  }
  centredText(image, 'DURAK', x + 64, y + 26, 16, WHITE, OPAQUE, 0.16);
}

/** A dry-stone wall's face: flat stones of many sizes in rough courses, shadowed joints. */
function drawStones(image: PixelImage, rect: PixelRect): void {
  const courses = 5;
  const courseHeight = rect.height / courses;
  shadeRect(image, rect, (_u, _v, x, y, out) => {
    const course = Math.floor(y / courseHeight);
    // Stones of varying length along each course.
    const offset = grain(course, 5, 301) * 60;
    const stoneLength = 34 + 26 * grain(course, 9, 307);
    const stone = Math.floor((x + offset) / stoneLength);
    const inX = (x + offset) % stoneLength;
    const inY = y - course * courseHeight;
    const edge = Math.min(inX, stoneLength - inX, inY, courseHeight - inY);
    const joint = edge < 2.2;
    const tone = 0.78 + 0.34 * grain(stone, course, 311);
    const warm = grain(stone + 3, course, 313);
    const fleck = 0.9 + 0.2 * grain(x, y, 317);
    const shade = joint ? 0.35 : (0.85 + 0.15 * Math.min(1, edge / 6)) * tone * fleck;
    paint(out, (150 + 20 * warm) * shade, (146 + 10 * warm) * shade, 138 * shade);
  }, OPAQUE);
}
