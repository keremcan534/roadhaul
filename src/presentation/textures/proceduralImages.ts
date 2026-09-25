import { fractalNoise, grain } from './noise';
import { blendPixel, createImage, fillRect, mixRgb, shade, type PixelImage, type Rgb } from './pixelImage';
import { drawText, measureText } from './strokeFont';

/**
 * The game's procedural textures (see pixelImage.ts). Each function is
 * deterministic: the same arguments always give the same pixels. Colour
 * images are sRGB; materials tint several of them with vertex or material
 * colours, so they are mostly light and neutral.
 */

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Where the clouds' shadows fall, seen from above: tileable fractal noise in
 * grey (the higher, the cloudier), a few big blobs with ragged edges. Not a
 * colour image: the pre-lit ground reads it (PrelitMaterials).
 */
export function cloudShadowImage(size = 128, seed = 107): PixelImage {
  const image = createImage(size, size);
  const { data } = image;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = Math.round(fractalNoise(x / size, y / size, 4, 3, seed) * 255);
      const i = (y * size + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
    }
  }
  return image;
}

/**
 * Tileable meadow grass: small blotches of greens with fine grain, even
 * across the tile, so nothing larger repeats where it is tiled (the ground
 * lays larger lusher and drier patches over it).
 */
export function grassImage(size = 256, seed = 11): PixelImage {
  const image = createImage(size, size);
  const dark: Rgb = [52, 86, 36];
  const light: Rgb = [92, 128, 52];
  const dry: Rgb = [132, 132, 72];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const patches = fractalNoise(u, v, 8, 3, seed);
      const detail = fractalNoise(u, v, 24, 2, seed + 7);
      const dryness = smoothstep(0.62, 0.85, fractalNoise(u, v, 12, 2, seed + 13));
      const base = mixRgb(mixRgb(dark, light, patches * 0.55 + detail * 0.45), dry, dryness * 0.35);
      // Blades: per-pixel grain, stretched a little vertically by sampling pairs of rows.
      const blade = 0.8 + 0.4 * grain(x, y >> 1, seed + 3);
      blendPixel(image, x, y, [base[0] * blade, base[1] * blade, base[2] * blade], 1);
    }
  }
  return image;
}

/**
 * Asphalt across a two-lane road (u = across, 0 = left edge; v repeats along
 * the road): fine aggregate grain, a few pale stones and darker wheel tracks.
 */
export function asphaltImage(size = 256, seed = 23): PixelImage {
  const image = createImage(size, size, [66, 68, 72]);
  // Wheel tracks: two per lane, about 0.9 m either side of a lane centre on a 10 m road.
  const tracks = [0.16, 0.34, 0.66, 0.84];
  shade(image, (x, y) => {
    const u = x / size;
    const v = y / size;
    const mottling = 0.88 + 0.24 * fractalNoise(u, v, 8, 3, seed);
    const stone = grain(x, y, seed + 1);
    const speck = stone > 0.985 ? 1.45 : stone < 0.02 ? 0.7 : 0.94 + 0.12 * grain(x, y, seed + 2);
    let wear = 1;
    for (const track of tracks) {
      wear -= 0.08 * (1 - smoothstep(0.015, 0.05, Math.abs(u - track)));
    }
    return mottling * speck * wear;
  });
  return image;
}

/** Packed gravel and dirt for road shoulders. */
export function gravelImage(size = 128, seed = 31): PixelImage {
  const image = createImage(size, size, [128, 116, 96]);
  shade(image, (x, y) => {
    const u = x / size;
    const v = y / size;
    const stones = grain(x, y, seed);
    return (0.8 + 0.35 * fractalNoise(u, v, 8, 3, seed + 1)) * (stones > 0.9 ? 1.25 : stones < 0.1 ? 0.75 : 1);
  });
  return image;
}

/** Tileable beach sand: pale and fine-grained, with faint ripples the waves left and damper patches. */
export function sandImage(size = 128, seed = 73): PixelImage {
  const image = createImage(size, size, [226, 210, 172]);
  shade(image, (x, y) => {
    const u = x / size;
    const v = y / size;
    // Whole waves across the tile, bent by noise, so the ripples tile too.
    const ripples = 0.96 + 0.04 * Math.sin((u * 5 + 0.8 * fractalNoise(u, v, 4, 2, seed)) * Math.PI * 2);
    const patches = 0.92 + 0.12 * fractalNoise(u, v, 6, 3, seed + 1);
    const fine = 0.93 + 0.12 * grain(x, y, seed + 2);
    return ripples * patches * fine;
  });
  return image;
}

/**
 * Concrete yard slabs, 2 × 2 slabs per tile: pale, mottled, with a few oil
 * stains and dark joints between the slabs.
 */
export function concreteImage(size = 256, seed = 37): PixelImage {
  const image = createImage(size, size, [172, 170, 164]);
  const half = size / 2;
  shade(image, (x, y) => {
    const u = x / size;
    const v = y / size;
    const mottling = 0.9 + 0.16 * fractalNoise(u, v, 6, 3, seed);
    const stain = 1 - 0.22 * smoothstep(0.62, 0.8, fractalNoise(u, v, 3, 2, seed + 5));
    const fine = 0.95 + 0.1 * grain(x, y, seed + 1);
    // Joints on the tile edges and through the middle, 2 px wide.
    const joint = x % half < 2 || y % half < 2 ? 0.62 : 1;
    return mottling * stain * fine * joint;
  });
  return image;
}

/**
 * Office facade, 2 bays × 2 floors (8 m × 7 m of wall): plaster with window
 * rows and floor bands. Light, so vertex colours can tint the wall.
 */
export function officeFacadeImage(size = 256, seed = 41): PixelImage {
  const image = createImage(size, size, [236, 234, 228]);
  shade(image, (x, y) => 0.94 + 0.08 * fractalNoise(x / size, y / size, 16, 2, seed));
  const cell = size / 2;
  for (let floor = 0; floor < 2; floor++) {
    const y0 = floor * cell;
    // Floor slab band.
    fillRect(image, 0, y0, size, y0 + cell * 0.06, [196, 194, 188]);
    for (let bay = 0; bay < 2; bay++) {
      const x0 = bay * cell;
      const left = x0 + cell * 0.2;
      const right = x0 + cell * 0.8;
      const bottom = y0 + cell * 0.3;
      const top = y0 + cell * 0.8;
      fillRect(image, left - 3, bottom - 3, right + 3, top + 3, [250, 250, 248]); // Frame.
      const reflect = 0.8 + 0.4 * grain(bay, floor, seed);
      for (let y = Math.floor(bottom); y < top; y++) {
        const sky = (y - bottom) / (top - bottom);
        const glass = mixRgb([34, 48, 64], [92, 120, 146], sky * 0.8);
        for (let x = Math.floor(left); x < right; x++) {
          blendPixel(image, x, y, [glass[0] * reflect, glass[1] * reflect, glass[2] * reflect], 1);
        }
      }
      fillRect(image, (left + right) / 2 - 1.5, bottom, (left + right) / 2 + 1.5, top, [210, 212, 214]); // Mullion.
      fillRect(image, left - 5, bottom - 7, right + 5, bottom - 3, [170, 168, 162]); // Sill.
    }
  }
  return image;
}

/**
 * Warehouse cladding, 8 m × 7 m: vertical corrugated ribs with a band of high
 * windows under the eaves.
 */
export function warehouseFacadeImage(size = 256, seed = 43): PixelImage {
  const image = createImage(size, size, [228, 228, 224]);
  shade(image, (x, y) => {
    const rib = 0.86 + 0.14 * Math.abs(Math.sin((x / size) * Math.PI * 32));
    return rib * (0.95 + 0.07 * fractalNoise(x / size, y / size, 8, 2, seed));
  });
  for (let window = 0; window < 4; window++) {
    const x0 = (window + 0.18) * (size / 4);
    const x1 = (window + 0.82) * (size / 4);
    fillRect(image, x0 - 2, size * 0.8 - 2, x1 + 2, size * 0.9 + 2, [200, 200, 196]);
    fillRect(image, x0, size * 0.8, x1, size * 0.9, [52, 66, 80]);
  }
  fillRect(image, 0, 0, size, size * 0.04, [150, 150, 146]); // Plinth.
  return image;
}

/**
 * Office windows lit at night, as an emissive map: `tiles` × `tiles` facade
 * tiles in officeFacadeImage()'s layout (2 bays × 2 floors each), with about
 * half the windows glowing warm, each a little differently. Black elsewhere.
 */
export function officeWindowLightsImage(tiles = 4, tileSize = 64, seed = 53): PixelImage {
  const size = tiles * tileSize;
  const image = createImage(size, size, [0, 0, 0]);
  const cell = tileSize / 2;
  for (let row = 0; row < tiles * 2; row++) {
    for (let column = 0; column < tiles * 2; column++) {
      if (grain(column, row, seed) < 0.45) {
        continue;
      }
      const x0 = column * cell;
      const y0 = row * cell;
      fillRect(image, x0 + cell * 0.2, y0 + cell * 0.3, x0 + cell * 0.8, y0 + cell * 0.8, windowLight(grain(column, row, seed + 1)));
    }
  }
  return image;
}

/** The same for warehouses: warehouseFacadeImage()'s row of four high windows per tile. */
export function warehouseWindowLightsImage(tiles = 4, tileSize = 64, seed = 59): PixelImage {
  const size = tiles * tileSize;
  const image = createImage(size, size, [0, 0, 0]);
  const pane = tileSize / 4;
  for (let row = 0; row < tiles; row++) {
    for (let column = 0; column < tiles * 4; column++) {
      if (grain(column, row, seed) < 0.5) {
        continue;
      }
      const y0 = row * tileSize;
      fillRect(
        image,
        (column + 0.18) * pane,
        y0 + tileSize * 0.8,
        (column + 0.82) * pane,
        y0 + tileSize * 0.9,
        windowLight(grain(column, row, seed + 1)),
      );
    }
  }
  return image;
}

/** Warm window light, from a dim amber (t = 0) to a bright cream (t = 1). */
function windowLight(t: number): Rgb {
  return mixRgb([150, 96, 40], [255, 214, 150], t);
}

/** A lamp's glow at night: white, its alpha fading from a bright core out to a soft halo. */
export function glowImage(size = 64): PixelImage {
  const image = createImage(size, size, [255, 255, 255], 0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2;
      const halo = Math.max(0, 1 - r) ** 2.5;
      const core = 1 - smoothstep(0.08, 0.3, r);
      image.data[(y * size + x) * 4 + 3] = Math.round(255 * Math.min(1, halo * 0.8 + core));
    }
  }
  return image;
}

/**
 * A puff of smoke, dust or spray: white (the particle's colour tints it), its
 * alpha a soft round cloud, lumpy with noise, clear at the square's edge.
 */
export function puffImage(size = 64, seed = 71): PixelImage {
  const image = createImage(size, size, [255, 255, 255], 0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const r = Math.hypot(u - 0.5, v - 0.5) * 2;
      const body = (1 - smoothstep(0.15, 1, r)) ** 1.5;
      const lumps = 0.55 + 0.45 * fractalNoise(u, v, 4, 3, seed);
      image.data[(y * size + x) * 4 + 3] = Math.round(255 * Math.min(1, body * lumps * 1.25));
    }
  }
  return image;
}

/**
 * Soft blotches that tile, grey (not sRGB: a factor): where a meadow grows
 * lusher (dark) or drier (light), on a scale of tens of meters.
 */
export function meadowImage(size = 64, seed = 89): PixelImage {
  const image = createImage(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = Math.round(255 * smoothstep(0.25, 0.75, fractalNoise((x + 0.5) / size, (y + 0.5) / size, 4, 3, seed)));
      const i = (y * size + x) * 4;
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
    }
  }
  return image;
}

/**
 * One puff of a cumulus cloud, for the sky's billboards. Alpha is how dense
 * it is: a soft ball whose rim is broken into billows by noise, clear well
 * inside the square. The grey (not sRGB: a factor) mottles the light on it,
 * brighter billows and darker folds, around 0.75.
 */
export function cloudPuffImage(size = 64, seed = 97): PixelImage {
  const image = createImage(size, size, [255, 255, 255], 0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const r = Math.hypot(u - 0.5, v - 0.5) * 2;
      const rim = 0.62 + 0.3 * fractalNoise(u, v, 3, 3, seed);
      const density = (1 - smoothstep(rim - 0.5, rim, r)) * (0.82 + 0.18 * fractalNoise(u, v, 6, 2, seed + 5));
      const billows = Math.round(255 * (0.55 + 0.45 * fractalNoise(u, v, 5, 3, seed + 11)));
      const i = (y * size + x) * 4;
      image.data[i] = billows;
      image.data[i + 1] = billows;
      image.data[i + 2] = billows;
      image.data[i + 3] = Math.round(255 * Math.min(1, density));
    }
  }
  return image;
}

/**
 * The full moon, filling the square but for a pixel round it: pale highlands,
 * darker seas, a little grain, and a rim a shade darker than the middle. The
 * corners are transparent (in the highlands' colour, so filtering leaves no
 * dark fringe).
 */
export function moonImage(size = 64, seed = 67): PixelImage {
  const highland: Rgb = [240, 238, 229];
  const sea: Rgb = [176, 181, 188];
  const image = createImage(size, size, highland, 0);
  const rim = 1 - 1 / size;
  const edge = 1.5 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const r = Math.hypot(u - 0.5, v - 0.5) * 2;
      const disc = 1 - smoothstep(rim - edge, rim + edge, r);
      if (disc <= 0) {
        continue;
      }
      const seas = smoothstep(0.52, 0.62, fractalNoise(u, v, 3, 3, seed));
      const light = (1 - 0.16 * r * r) * (0.95 + 0.05 * grain(x, y, seed));
      const color = mixRgb(highland, sea, seas);
      const i = (y * size + x) * 4;
      image.data[i] = Math.round(color[0] * light);
      image.data[i + 1] = Math.round(color[1] * light);
      image.data[i + 2] = Math.round(color[2] * light);
      image.data[i + 3] = Math.round(255 * disc);
    }
  }
  return image;
}

/**
 * The cities' name boards, one row per name from the bottom up: dark blue
 * capitals on a white board inside a blue frame. Names too long for the
 * board are drawn smaller. A board's face maps onto its row (see
 * CitySignView).
 */
export function citySignImage(names: readonly string[], width = 512, rowHeight = 160): PixelImage {
  const image = createImage(width, Math.max(1, names.length) * rowHeight, [246, 247, 243]);
  const frame: Rgb = [30, 70, 140];
  const inset = rowHeight * 0.05;
  const thickness = rowHeight * 0.045;
  names.forEach((name, row) => {
    const bottom = row * rowHeight;
    const top = bottom + rowHeight;
    fillRect(image, inset, bottom + inset, width - inset, bottom + inset + thickness, frame);
    fillRect(image, inset, top - inset - thickness, width - inset, top - inset, frame);
    fillRect(image, inset, bottom + inset, inset + thickness, top - inset, frame);
    fillRect(image, width - inset - thickness, bottom + inset, width - inset, top - inset, frame);
    const fit = { height: rowHeight * 0.44, weight: 0.17, spacing: 0.3, slant: 0, color: [22, 42, 84] as Rgb };
    const style = { ...fit, height: fit.height * Math.min(1, (width * 0.84) / measureText(name, fit)) };
    drawText(image, name, (width - measureText(name, style)) / 2, bottom + (rowHeight - style.height) / 2, style);
  });
  shade(image, (x, y) => 0.97 + 0.03 * fractalNoise(x / width, y / image.height, 6, 2, 17));
  return image;
}

/**
 * Crop rows for the farm fields, tileable: `rows` light ridges and dark
 * furrows across the tile (along u), with fine grain. Grey, so each field
 * tints it with its crop's colour.
 */
export function fieldRowsImage(size = 64, rows = 4, seed = 61): PixelImage {
  const image = createImage(size, size, [255, 255, 255]);
  shade(image, (x, y) => {
    const ridge = 0.5 + 0.5 * Math.cos(((x + 0.5) / size) * rows * Math.PI * 2);
    return 0.7 + 0.24 * ridge + 0.06 * grain(x, y, seed);
  });
  return image;
}

/** A soft round shadow (black with falling-off alpha) for trees and the truck. */
export function softShadowImage(size = 64): PixelImage {
  const image = createImage(size, size, [0, 0, 0], 0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2;
      image.data[(y * size + x) * 4 + 3] = Math.round(255 * (1 - smoothstep(0.25, 1, r)) ** 1.4);
    }
  }
  return image;
}

/**
 * Clay roof tiles (u along the eaves, v up the slope): rows of rounded
 * terracotta tiles, each row shifted half a tile from the one below and
 * shadowed where the row above laps over it, every tile a little different.
 * Four tiles across and four rows up; light, for a vertex colour to tint.
 */
export function roofTilesImage(size = 64, seed = 101): PixelImage {
  const image = createImage(size, size);
  const clay: Rgb = [196, 104, 70];
  const columns = 4;
  const rows = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = ((y + 0.5) / size) * rows;
      const row = Math.floor(v);
      const up = v - row;
      const u = ((x + 0.5) / size) * columns + (row % 2) * 0.5;
      const column = Math.floor(u);
      const across = u - column;
      const crown = 0.7 + 0.3 * Math.sin(across * Math.PI);
      const lapped = 1 - 0.38 * smoothstep(0.78, 1, up);
      const light = crown * lapped * (0.88 + 0.22 * grain(column % columns, row, seed));
      blendPixel(image, x, y, [clay[0] * light, clay[1] * light, clay[2] * light], 1);
    }
  }
  return image;
}

/** A soft-edged rectangle shadow for buildings. */
export function softBoxShadowImage(size = 64): PixelImage {
  const image = createImage(size, size, [0, 0, 0], 0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.max(Math.abs((x + 0.5) / size - 0.5), Math.abs((y + 0.5) / size - 0.5)) * 2;
      image.data[(y * size + x) * 4 + 3] = Math.round(255 * (1 - smoothstep(0.55, 1, d)));
    }
  }
  return image;
}

/**
 * Side of the cargo box: white panels, the company stripes in `accent` and
 * the RoadHaul logo. 2:1, matching the box side. Symmetric apart from the
 * lettering, so it suits both sides of the truck.
 */
export function liveryImage(accent: Rgb, width = 1024, height = 512): PixelImage {
  const image = createImage(width, height, [242, 242, 238]);
  // Panel seams and a little road grime toward the bottom.
  for (let panel = 1; panel < 6; panel++) {
    fillRect(image, (panel * width) / 6 - 1, 0, (panel * width) / 6 + 1, height, [206, 206, 202]);
  }
  shade(image, (x, y) => 0.9 + 0.1 * smoothstep(0, 0.35, y / height) + 0.03 * fractalNoise(x / width, y / height, 8, 2, 5));
  // Stripes: a broad accent band with a thin dark line above, rising into a chevron at each end.
  fillRect(image, 0, height * 0.08, width, height * 0.22, accent);
  fillRect(image, 0, height * 0.245, width, height * 0.27, [44, 52, 64]);
  for (let y = Math.floor(height * 0.08); y < height * 0.62; y++) {
    const rise = ((y - height * 0.08) / (height * 0.54)) * width * 0.08;
    for (let x = 0; x < width * 0.06; x++) {
      blendPixel(image, Math.floor(width * 0.02 + rise + x), y, accent, 1);
      blendPixel(image, Math.floor(width * 0.98 - rise - x), y, accent, 1);
    }
  }
  const style = { height: height * 0.2, weight: 0.17, spacing: 0.12, slant: 0.16, color: [44, 52, 64] as Rgb };
  drawText(image, 'ROADHAUL', (width - measureText('ROADHAUL', style)) / 2, height * 0.42, style);
  return image;
}

/**
 * Rear doors of the cargo box: the logo across the top, an accent band,
 * centre seam, locking bars, hinges and a reflector strip.
 */
export function rearDoorsImage(accent: Rgb, size = 512): PixelImage {
  const image = createImage(size, size, [236, 236, 232]);
  shade(image, (_x, y) => 0.92 + 0.08 * smoothstep(0, 0.4, y / size));
  fillRect(image, 0, size * 0.1, size, size * 0.17, accent);
  const style = { height: size * 0.075, weight: 0.18, spacing: 0.12, slant: 0.16, color: [44, 52, 64] as Rgb };
  drawText(image, 'ROADHAUL', (size - measureText('ROADHAUL', style)) / 2, size * 0.8, style);
  fillRect(image, size * 0.497, 0, size * 0.503, size, [70, 74, 80]); // Seam.
  for (const u of [0.22, 0.34, 0.66, 0.78]) {
    fillRect(image, size * u - 4, size * 0.04, size * u + 4, size * 0.74, [150, 154, 160]); // Locking bars.
    fillRect(image, size * u - 10, size * 0.4, size * u + 10, size * 0.44, [90, 94, 100]); // Handles.
  }
  for (const v of [0.12, 0.45, 0.78]) {
    fillRect(image, 0, size * v - 8, size * 0.05, size * v + 8, [120, 124, 130]); // Hinges.
    fillRect(image, size * 0.95, size * v - 8, size, size * v + 8, [120, 124, 130]);
  }
  for (let block = 0; block < 16; block++) {
    const colour: Rgb = block % 2 === 0 ? [200, 40, 36] : [245, 245, 245];
    fillRect(image, (block * size) / 16, size * 0.02, ((block + 1) * size) / 16, size * 0.07, colour);
  }
  return image;
}

/** Radiator grille: horizontal bars in a dark surround. */
export function grilleImage(size = 128): PixelImage {
  const image = createImage(size, size, [26, 28, 32]);
  for (let bar = 0; bar < 7; bar++) {
    const y = size * (0.1 + bar * 0.12);
    fillRect(image, size * 0.06, y, size * 0.94, y + size * 0.05, [150, 156, 164]);
  }
  return image;
}

/** Wheel rim seen from the side: lip, spoke holes, hub and wheel nuts. */
export function rimImage(size = 128): PixelImage {
  const image = createImage(size, size, [34, 34, 36]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.hypot(dx, dy) * 2;
      const angle = Math.atan2(dy, dx);
      let colour: Rgb = [30, 30, 32]; // Tyre sidewall beyond the rim.
      if (r < 0.74) {
        const lip = r > 0.66 ? 0.8 : 1;
        const hole = r > 0.36 && r < 0.58 && Math.cos(angle * 6) > 0.55;
        colour = hole ? [40, 42, 46] : [Math.round(188 * lip), Math.round(192 * lip), Math.round(198 * lip)];
        if (r < 0.22) {
          colour = [150, 154, 160];
          // Five wheel nuts on a small circle around the centre.
          const nutAngle = Math.round(angle / ((2 * Math.PI) / 5)) * ((2 * Math.PI) / 5);
          if (Math.hypot(dx - Math.cos(nutAngle) * 0.07, dy - Math.sin(nutAngle) * 0.07) < 0.02) {
            colour = [90, 92, 96];
          }
        }
      }
      blendPixel(image, x, y, colour, 1);
    }
  }
  return image;
}
