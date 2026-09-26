import { clamp, smoothstep } from '../../core/math/scalar';
import { arcBand, centredText, disc, fillRect, line, paint, roundedBox, shadeRect, type PixelRect } from './drawing';
import { grain } from './noise';
import { blendPixel, createImage, mixRgb, type PixelImage, type Rgb } from './pixelImage';

/**
 * The cab's inside in one picture (an atlas), so all of it draws with one
 * material: the instrument cluster, the steering wheel's badge, the switches,
 * vents, radio and speaker, the seats' fabric, the curtain, the floor mat,
 * and plain swatches for everything painted in one colour. Original designs.
 *
 * The alpha is not see-through: it marks what glows (the dials' markings,
 * the needles, displays and lamps), which the cab's material lights up at
 * night (cabinShading.ts). Row 0 is the bottom, as in pixelImage.ts.
 */

/** A rectangle of the atlas, in pixels from its bottom-left corner. */
export type AtlasRect = PixelRect;

export const CAB_ATLAS_WIDTH = 1024;
export const CAB_ATLAS_HEIGHT = 512;

/** 32-pixel swatches in a row, sampled at their middles: one colour each, plain or glowing. */
function swatch(index: number): AtlasRect {
  return { x: 648 + index * 48, y: 136, width: 32, height: 32 };
}

export const CAB_ATLAS = {
  cluster: { x: 0, y: 256, width: 768, height: 256 },
  emblem: { x: 768, y: 384, width: 128, height: 128 },
  speaker: { x: 896, y: 384, width: 128, height: 128 },
  radio: { x: 768, y: 256, width: 256, height: 128 },
  switches: { x: 0, y: 128, width: 512, height: 128 },
  vent: { x: 512, y: 128, width: 128, height: 128 },
  fabric: { x: 0, y: 0, width: 256, height: 128 },
  curtain: { x: 256, y: 0, width: 256, height: 128 },
  mat: { x: 512, y: 0, width: 256, height: 128 },
  lids: { x: 768, y: 0, width: 256, height: 64 },
  slots: { x: 768, y: 64, width: 256, height: 64 },
  /** White, as the vertex colours paint it. */
  plain: swatch(0),
  /** White that glows: displays' segments, tinted by their colour. */
  glow: swatch(1),
  /** The needles' orange, glowing. */
  needle: swatch(2),
} as const satisfies Readonly<Record<string, AtlasRect>>;

/** A dial on the cluster: where its needle turns, and over what scale. */
export interface DialLayout {
  /** The needle's pivot, in pixels of the cluster picture from its bottom-left corner. */
  readonly x: number;
  readonly y: number;
  /** The scale's radius, pixels. */
  readonly radius: number;
  /** Where the needle points at `min` (degrees counter-clockwise from +x), and how far clockwise it turns to `max`. */
  readonly startDegrees: number;
  readonly sweepDegrees: number;
  readonly min: number;
  readonly max: number;
}

/**
 * The cluster's dials: the rev counter and the speedometer, big either side
 * of the display; the brakes' air pressure (two circuits, one needle each) on
 * the left and the fuel on the right; the coolant's temperature and the
 * oil's pressure small under the big two.
 */
export const CLUSTER_DIALS = {
  tachometer: { x: 224, y: 132, radius: 100, startDegrees: 210, sweepDegrees: 240, min: 0, max: 3000 },
  speedometer: { x: 544, y: 132, radius: 100, startDegrees: 210, sweepDegrees: 240, min: 0, max: 125 },
  air: { x: 64, y: 150, radius: 50, startDegrees: 210, sweepDegrees: 240, min: 0, max: 10 },
  fuel: { x: 704, y: 150, radius: 50, startDegrees: 210, sweepDegrees: 240, min: 0, max: 1 },
  temperature: { x: 224, y: 36, radius: 30, startDegrees: 150, sweepDegrees: 120, min: 0, max: 1 },
  oil: { x: 544, y: 36, radius: 30, startDegrees: 150, sweepDegrees: 120, min: 0, max: 5 },
} as const satisfies Readonly<Record<string, DialLayout>>;

/** The display between the big dials (pixels of the cluster picture): the clock above, the gear below. */
export const CLUSTER_DISPLAY = { x: 336, y: 64, width: 96, height: 148 } as const;

/** The way a dial's needle points for `value` (clamped to its scale): radians counter-clockwise from +x. */
export function dialAngle(dial: DialLayout, value: number): number {
  const fraction = clamp((value - dial.min) / (dial.max - dial.min), 0, 1);
  return ((dial.startDegrees - fraction * dial.sweepDegrees) * Math.PI) / 180;
}

const WHITE: Rgb = [236, 239, 242];
const RED: Rgb = [232, 52, 40];
const GREEN: Rgb = [70, 206, 112];
const ORANGE: Rgb = [255, 150, 40];
const BLUE: Rgb = [70, 150, 255];
/** Glowing marks: fully, or a little (the lamps' tell-tales, unlit, still show their colour). */
const GLOWS = 255;
const DARK = 0;

/**
 * The whole atlas, for a truck whose engine is governed at `redlineRpm` and
 * whose speed is limited to `limiterKmh` (the rev counter's red and the
 * speedometer's mark). Deterministic: the same arguments give the same
 * picture.
 */
export function cabAtlasImage(redlineRpm: number, limiterKmh: number): PixelImage {
  const image = createImage(CAB_ATLAS_WIDTH, CAB_ATLAS_HEIGHT, [40, 42, 46], DARK);
  drawCluster(image, CAB_ATLAS.cluster, redlineRpm, limiterKmh);
  drawEmblem(image, CAB_ATLAS.emblem);
  drawSpeaker(image, CAB_ATLAS.speaker);
  drawRadio(image, CAB_ATLAS.radio);
  drawSwitches(image, CAB_ATLAS.switches);
  drawVent(image, CAB_ATLAS.vent);
  drawFabric(image, CAB_ATLAS.fabric);
  drawCurtain(image, CAB_ATLAS.curtain);
  drawMat(image, CAB_ATLAS.mat);
  drawLids(image, CAB_ATLAS.lids);
  drawSlots(image, CAB_ATLAS.slots);
  fillRect(image, CAB_ATLAS.plain, [255, 255, 255], DARK);
  fillRect(image, CAB_ATLAS.glow, [255, 255, 255], GLOWS);
  fillRect(image, CAB_ATLAS.needle, [255, 96, 30], GLOWS);
  return image;
}

/** Texture coordinates of `x`, `y` pixels into `rect`, for a mesh's uv (u right, v up). */
export function atlasUv(rect: AtlasRect, u: number, v: number): [number, number] {
  return [(rect.x + u * rect.width) / CAB_ATLAS_WIDTH, (rect.y + v * rect.height) / CAB_ATLAS_HEIGHT];
}

// --- The cluster. ----------------------------------------------------------------------------------------------

interface Scale {
  readonly minorStep: number;
  readonly majorStep: number;
  /** The numbers written at the major ticks: the value / `numberDivisor`. */
  readonly numberDivisor: number;
  readonly numbers: boolean;
}

function drawCluster(image: PixelImage, rect: AtlasRect, redlineRpm: number, limiterKmh: number): void {
  const { x: ox, y: oy } = rect;
  // Dark grained plastic, shaded under the hood at the top, and a faint glare across the glass.
  shadeRect(image, rect, (u, v, x, y, out) => {
    const base = 30 + 4 * grain(x, y, 7) + 2 * grain(x >> 1, y >> 1, 5);
    const hood = 1 - 0.45 * smoothstep(0.72, 1, v);
    const glare = 1 + 0.06 * (1 - smoothstep(0, 0.05, Math.abs(u * 0.9 - v * 0.5 - 0.1)));
    const level = base * hood * glare;
    paint(out, level, level * 1.04, level * 1.12);
  });

  const dials = CLUSTER_DIALS;
  const redFraction = clamp((redlineRpm - dials.tachometer.min) / (dials.tachometer.max - dials.tachometer.min), 0, 1);
  drawDial(image, ox, oy, dials.tachometer, { minorStep: 100, majorStep: 500, numberDivisor: 100, numbers: true }, [
    { from: 1000, to: 1600, color: GREEN },
    { from: dials.tachometer.min + redFraction * (dials.tachometer.max - dials.tachometer.min), to: dials.tachometer.max, color: RED },
  ]);
  centredText(image, '1/MIN X100', ox + dials.tachometer.x, oy + dials.tachometer.y - 34, 9, WHITE, GLOWS);
  drawDial(image, ox, oy, dials.speedometer, { minorStep: 5, majorStep: 20, numberDivisor: 1, numbers: true }, []);
  centredText(image, 'KM/H', ox + dials.speedometer.x, oy + dials.speedometer.y - 34, 10, WHITE, GLOWS);
  // The speed limiter's mark, orange, just inside the scale.
  const limit = dialAngle(dials.speedometer, limiterKmh);
  const sx = ox + dials.speedometer.x;
  const sy = oy + dials.speedometer.y;
  line(image, sx + Math.cos(limit) * 70, sy + Math.sin(limit) * 70, sx + Math.cos(limit) * 82, sy + Math.sin(limit) * 82, 5, ORANGE, GLOWS);

  drawDial(image, ox, oy, dials.air, { minorStep: 1, majorStep: 5, numberDivisor: 1, numbers: true }, [{ from: 0, to: 5.5, color: RED }]);
  centredText(image, 'BAR', ox + dials.air.x, oy + dials.air.y - 24, 8, WHITE, GLOWS);
  centredText(image, '1  2', ox + dials.air.x, oy + dials.air.y + 18, 7, WHITE, GLOWS);
  drawDial(image, ox, oy, dials.fuel, { minorStep: 0.125, majorStep: 0.5, numberDivisor: 1, numbers: false }, [
    { from: 0, to: 0.12, color: RED },
  ]);
  const fuel = dials.fuel;
  for (const [value, letter] of [
    [0, 'E'],
    [1, 'F'],
  ] as const) {
    const angle = dialAngle(fuel, value);
    centredText(image, letter, ox + fuel.x + Math.cos(angle) * 30, oy + fuel.y + Math.sin(angle) * 30, 10, WHITE, GLOWS);
  }
  drawPump(image, ox + fuel.x, oy + fuel.y - 26);

  drawDial(image, ox, oy, dials.temperature, { minorStep: 0.125, majorStep: 0.5, numberDivisor: 1, numbers: false }, [
    { from: 0, to: 0.1, color: BLUE },
    { from: 0.85, to: 1, color: RED },
  ]);
  drawThermometer(image, ox + dials.temperature.x, oy + dials.temperature.y - 4);
  drawDial(image, ox, oy, dials.oil, { minorStep: 0.5, majorStep: 2.5, numberDivisor: 1, numbers: false }, [{ from: 0, to: 0.8, color: RED }]);
  drawOilCan(image, ox + dials.oil.x, oy + dials.oil.y - 4);

  // The display's window between the big dials, and the lamps' tell-tales round it.
  const display = CLUSTER_DISPLAY;
  roundedBox(image, ox + display.x - 2, oy + display.y - 2, ox + display.x + display.width + 2, oy + display.y + display.height + 2, 9, [72, 76, 82], DARK);
  roundedBox(image, ox + display.x, oy + display.y, ox + display.x + display.width, oy + display.y + display.height, 7, [8, 10, 12], DARK);
  drawArrow(image, ox + display.x + 10, oy + 232, 1, [26, 70, 36]);
  drawArrow(image, ox + display.x + display.width - 10, oy + 232, -1, [26, 70, 36]);
  const tellTales: readonly Rgb[] = [
    [96, 26, 22],
    [96, 70, 18],
    [28, 72, 36],
    [26, 50, 100],
  ];
  for (let i = 0; i < tellTales.length; i++) {
    const cx = ox + display.x + 12 + i * 24;
    roundedBox(image, cx - 8, oy + 20, cx + 8, oy + 36, 4, tellTales[i]!, DARK);
  }
}

function drawDial(
  image: PixelImage,
  ox: number,
  oy: number,
  dial: DialLayout,
  scale: Scale,
  bands: readonly { readonly from: number; readonly to: number; readonly color: Rgb }[],
): void {
  const cx = ox + dial.x;
  const cy = oy + dial.y;
  const r = dial.radius;
  const big = r >= 80;
  // Face: dark, a touch lighter in the middle; a metal bezel lit from above.
  disc(image, cx, cy, r + (big ? 7 : 5), [62, 66, 72], DARK, 'lit', [206, 212, 218]);
  disc(image, cx, cy, r + 1, [28, 30, 34], DARK, 'radial', [12, 13, 15]);
  const toDegrees = (value: number): number => (dialAngle(dial, value) * 180) / Math.PI;
  for (const band of bands) {
    arcBand(image, cx, cy, r - (big ? 6 : 4), r - 1, toDegrees(band.from), toDegrees(band.to), band.color, GLOWS);
  }
  const steps = Math.round((dial.max - dial.min) / scale.minorStep);
  const majorEvery = Math.round(scale.majorStep / scale.minorStep);
  for (let step = 0; step <= steps; step++) {
    const value = dial.min + step * scale.minorStep;
    const major = step % majorEvery === 0 || step === steps;
    const angle = dialAngle(dial, value);
    const inner = r - (major ? (big ? 17 : 10) : big ? 9 : 6);
    const width = major ? (big ? 3.2 : 2.4) : big ? 1.6 : 1.3;
    line(image, cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner, cx + Math.cos(angle) * (r - 2), cy + Math.sin(angle) * (r - 2), width, WHITE, GLOWS);
    if (major && scale.numbers && step % majorEvery === 0) {
      const text = String(Math.round(value / scale.numberDivisor));
      const at = r - (big ? 34 : 19);
      centredText(image, text, cx + Math.cos(angle) * at, cy + Math.sin(angle) * at, big ? 15 : 9, WHITE, GLOWS, 0.16);
    }
  }
}

/** A fuel pump's outline. */
function drawPump(image: PixelImage, cx: number, cy: number): void {
  const color = WHITE;
  line(image, cx - 5, cy - 6, cx - 5, cy + 6, 1.6, color, GLOWS);
  line(image, cx + 3, cy - 6, cx + 3, cy + 6, 1.6, color, GLOWS);
  line(image, cx - 5, cy + 6, cx + 3, cy + 6, 1.6, color, GLOWS);
  line(image, cx - 7, cy - 6, cx + 5, cy - 6, 1.6, color, GLOWS);
  line(image, cx - 5, cy + 1, cx + 3, cy + 1, 1.2, color, GLOWS);
  line(image, cx + 3, cy + 3, cx + 7, cy + 1, 1.3, color, GLOWS);
  line(image, cx + 7, cy + 1, cx + 7, cy - 4, 1.3, color, GLOWS);
}

/** A thermometer standing in waves. */
function drawThermometer(image: PixelImage, cx: number, cy: number): void {
  line(image, cx, cy - 3, cx, cy + 7, 2, WHITE, GLOWS);
  disc(image, cx, cy - 4, 2.6, WHITE, GLOWS);
  for (const dx of [-6, 6]) {
    line(image, cx + dx - 2, cy - 6, cx + dx + 2, cy - 6, 1.2, WHITE, GLOWS);
  }
}

/** An oil can with its drop. */
function drawOilCan(image: PixelImage, cx: number, cy: number): void {
  line(image, cx - 7, cy - 3, cx + 3, cy - 3, 1.5, WHITE, GLOWS);
  line(image, cx - 7, cy - 3, cx - 7, cy + 2, 1.5, WHITE, GLOWS);
  line(image, cx - 7, cy + 2, cx + 1, cy + 2, 1.5, WHITE, GLOWS);
  line(image, cx + 1, cy + 2, cx + 7, cy + 4, 1.4, WHITE, GLOWS);
  line(image, cx + 3, cy - 3, cx + 1, cy + 2, 1.4, WHITE, GLOWS);
  disc(image, cx + 7, cy - 1, 1.3, WHITE, GLOWS);
}

/** A turn indicator's arrow pointing left (`direction` 1) or right (-1), unlit. */
function drawArrow(image: PixelImage, cx: number, cy: number, direction: 1 | -1, color: Rgb): void {
  for (let i = 0; i < 9; i++) {
    const x = cx - direction * (4 - i);
    const half = i < 5 ? i * 1.3 : 2.2;
    line(image, x, cy - half, x, cy + half, 1.4, color, DARK);
  }
}

// --- The rest of the cab. --------------------------------------------------------------------------------------

/** The steering wheel's badge: an original monogram in a chrome ring. */
function drawEmblem(image: PixelImage, rect: AtlasRect): void {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  fillRect(image, rect, [34, 36, 40], DARK);
  disc(image, cx, cy, 60, [90, 94, 100], DARK, 'lit', [226, 230, 234], 0.6);
  disc(image, cx, cy, 53, [40, 44, 52], DARK, 'radial', [18, 20, 24]);
  centredText(image, 'RH', cx, cy, 40, [214, 218, 222], DARK, 0.17);
}

/** A speaker's grille: a field of small holes in a dark ring. */
function drawSpeaker(image: PixelImage, rect: AtlasRect): void {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  fillRect(image, rect, [34, 35, 38], DARK);
  disc(image, cx, cy, 60, [26, 27, 29], DARK);
  for (let row = -9; row <= 9; row++) {
    for (let column = -9; column <= 9; column++) {
      const x = cx + column * 6 + (row % 2 === 0 ? 0 : 3);
      const y = cy + row * 5.2;
      if (Math.hypot(x - cx, y - cy) < 52) {
        disc(image, x, y, 1.6, [8, 8, 9], DARK);
      }
    }
  }
}

/** The radio in the roof console: its display lit amber, buttons and two knobs. */
function drawRadio(image: PixelImage, rect: AtlasRect): void {
  const { x, y } = rect;
  shadeRect(image, rect, (_u, v, px, py, out) => {
    const level = 22 + 4 * v + 3 * grain(px, py, 17);
    paint(out, level, level, level * 1.08);
  });
  roundedBox(image, x + 44, y + 64, x + 212, y + 108, 5, [26, 16, 6], DARK);
  centredText(image, 'FM 98.4', x + 128, y + 86, 22, ORANGE, GLOWS, 0.13);
  for (let i = 0; i < 6; i++) {
    roundedBox(image, x + 52 + i * 26, y + 26, x + 72 + i * 26, y + 44, 4, [52, 54, 58], DARK);
    disc(image, x + 62 + i * 26, y + 40, 1.6, ORANGE, GLOWS);
  }
  for (const kx of [x + 22, x + 234]) {
    disc(image, kx, y + 64, 15, [30, 32, 36], DARK, 'lit', [120, 126, 134], 0.8);
    disc(image, kx, y + 64, 11, [40, 42, 46], DARK);
  }
}

/** A row of rocker switches with their symbols (lit at night) under the navigation screen. */
function drawSwitches(image: PixelImage, rect: AtlasRect): void {
  const { x, y, width, height } = rect;
  shadeRect(image, rect, (_u, v, px, py, out) => {
    const level = 38 + 5 * v + 3 * grain(px, py, 19);
    paint(out, level, level * 1.02, level * 1.08);
  });
  const count = 8;
  const pitch = width / count;
  for (let i = 0; i < count; i++) {
    const cx = x + pitch * (i + 0.5);
    roundedBox(image, cx - 22, y + 18, cx + 22, y + height - 18, 6, [18, 19, 22], DARK);
    roundedBox(image, cx - 19, y + height / 2 + 2, cx + 19, y + height - 21, 5, [44, 46, 51], DARK);
    roundedBox(image, cx - 19, y + 21, cx + 19, y + height / 2 - 2, 5, [30, 32, 36], DARK);
    disc(image, cx, y + height - 30, 2.2, [70, 46, 12], DARK);
    const icon = mixRgb(WHITE, [150, 156, 162], 0.3);
    const cy = y + 40;
    if (i === 3) {
      // The hazard lights: a red triangle.
      for (const [ax, ay, bx, by] of [
        [-9, -7, 9, -7],
        [9, -7, 0, 8],
        [0, 8, -9, -7],
      ] as const) {
        line(image, cx + ax, cy + ay, cx + bx, cy + by, 2.4, RED, GLOWS);
      }
    } else if (i % 3 === 0) {
      // A lamp: a half-disc with rays.
      arcBand(image, cx - 2, cy, 5, 7, 90, 270, icon, GLOWS);
      for (let ray = -1; ray <= 1; ray++) {
        line(image, cx + 3, cy + ray * 4, cx + 10, cy + ray * 5, 1.3, icon, GLOWS);
      }
    } else if (i % 3 === 1) {
      // A lock over a wheel: the axle's differential.
      arcBand(image, cx, cy, 6, 8, 0, 0, icon, GLOWS);
      line(image, cx - 10, cy, cx + 10, cy, 1.4, icon, GLOWS);
      line(image, cx, cy - 10, cx, cy + 10, 1.4, icon, GLOWS);
    } else {
      // Heated mirror: a frame with waves.
      line(image, cx - 8, cy - 7, cx + 8, cy - 7, 1.4, icon, GLOWS);
      line(image, cx - 8, cy + 7, cx + 8, cy + 7, 1.4, icon, GLOWS);
      for (const dx of [-4, 0, 4]) {
        line(image, cx + dx - 1, cy - 4, cx + dx + 1, cy + 4, 1.2, icon, GLOWS);
      }
    }
  }
}

/** An air vent: slats in a frame, with an adjuster. */
function drawVent(image: PixelImage, rect: AtlasRect): void {
  const { x, y, width, height } = rect;
  roundedBox(image, x + 2, y + 2, x + width - 2, y + height - 2, 14, [48, 50, 55], DARK);
  roundedBox(image, x + 10, y + 10, x + width - 10, y + height - 10, 10, [12, 13, 15], DARK);
  for (let slat = 0; slat < 7; slat++) {
    const bottom = y + 16 + slat * 14;
    for (let row = 0; row < 7; row++) {
      const level = 70 - row * 7;
      for (let px = x + 14; px < x + width - 14; px++) {
        blendPixel(image, px, bottom + row, [level, level + 2, level + 6], 1, DARK);
      }
    }
  }
  roundedBox(image, x + width / 2 - 9, y + height / 2 - 6, x + width / 2 + 9, y + height / 2 + 6, 4, [96, 100, 108], DARK);
}

/** Seat fabric: a woven grey with a finer centre panel between stitched seams. */
function drawFabric(image: PixelImage, rect: AtlasRect): void {
  shadeRect(image, rect, (u, v, px, py, out) => {
    const weave = 0.9 + 0.1 * ((px + py) % 4 < 2 ? 1 : 0) + 0.06 * grain(px, py, 23);
    const panel = u > 0.26 && u < 0.74;
    const ribs = panel ? 0.92 + 0.08 * Math.sin(py * 1.4) : 1;
    const seam = Math.abs(u - 0.26) < 0.006 || Math.abs(u - 0.74) < 0.006 ? (py % 6 < 3 ? 1.55 : 0.8) : 1;
    // Worn a little lighter where the driver sits.
    const wear = 0.95 + 0.07 * (1 - Math.abs(u - 0.5) * 2) * (0.6 + 0.4 * Math.sin(v * Math.PI));
    const f = weave * ribs * seam * wear;
    if (panel) {
      paint(out, 84 * f, 88 * f, 98 * f);
    } else {
      paint(out, 104 * f, 107 * f, 114 * f);
    }
  });
}

/** The sleeper's curtain: soft vertical folds in a blue-grey cloth, a hem at the foot. */
function drawCurtain(image: PixelImage, rect: AtlasRect): void {
  shadeRect(image, rect, (u, v, px, py, out) => {
    // Folds that wander a little down the cloth.
    const folds = 0.8 + 0.2 * (0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 14 + 0.9 * Math.sin(v * 5 + u * 17)));
    const hem = v < 0.06 ? 0.75 : 1;
    const f = folds * hem * (0.96 + 0.06 * grain(px, py, 37));
    paint(out, 112 * f, 120 * f, 140 * f);
  });
}

/** A ribbed rubber floor mat. */
function drawMat(image: PixelImage, rect: AtlasRect): void {
  shadeRect(image, rect, (u, v, px, py, out) => {
    const border = Math.min(u, 1 - u, v, 1 - v) < 0.04;
    const rib = !border && px % 8 < 3 ? 1.35 : 1;
    const level = (border ? 40 : 30) * rib + 3 * grain(px, py, 41);
    paint(out, level, level, level * 1.04);
  });
}

/** The roof console's lids: shut lines and latches in light plastic. */
function drawLids(image: PixelImage, rect: AtlasRect): void {
  const { x, y, width, height } = rect;
  shadeRect(image, rect, (_u, v, px, py, out) => {
    const level = 150 + 12 * v + 4 * grain(px, py, 43);
    paint(out, level, level * 1.01, level * 1.03);
  });
  for (let lid = 0; lid < 2; lid++) {
    const x0 = x + 6 + lid * (width / 2);
    const x1 = x0 + width / 2 - 12;
    roundedBox(image, x0 - 1, y + 5, x1 + 1, y + height - 5, 6, [96, 98, 102], DARK);
    roundedBox(image, x0, y + 6, x1, y + height - 6, 5, [164, 166, 170], DARK);
    roundedBox(image, (x0 + x1) / 2 - 16, y + 10, (x0 + x1) / 2 + 16, y + 18, 3, [36, 37, 40], DARK);
  }
}

/** Slots: the demister's grille along the windscreen, or a speaker's slits. */
function drawSlots(image: PixelImage, rect: AtlasRect): void {
  shadeRect(image, rect, (u, v, px, _py, out) => {
    const edge = v < 0.12 || v > 0.88 || u < 0.01 || u > 0.99;
    if (edge) {
      paint(out, 44, 46, 50);
    } else if (px % 6 < 3) {
      paint(out, 12, 13, 15);
    } else {
      paint(out, 52, 54, 58);
    }
  });
}
