import { BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Vector3 } from 'three';
import type { SeededRandom } from '../../core/random/SeededRandom';
import { CONTAINER_GAP_METERS, CONTAINER_METERS } from '../../domain/world/containerStacks';
import type { BuildingObstacle, BuildingSide } from '../../domain/world/DrivingWorld';

/**
 * The parts buildings are dressed in beyond their walls (TrackView): roofs,
 * the stone plinth at their foot, parapets, and what stands on flat roofs.
 * Original designs, generic to the region: terracotta hipped roofs, water
 * tanks and the solar water heaters common on its rooftops, and the plant
 * of industrial roofs. Pure geometry builders, run once at load.
 */

/** How a building is roofed: a hipped roof in clay tiles, a flat roof behind a parapet, or a shallow metal gable. */
export type RoofStyle = 'hip' | 'flat' | 'gable';

/** Clay tiles on hipped roofs repeat every this many meters along the eaves and up the slope. */
export const ROOF_TILE_METERS = { along: 1.6, up: 1.2 } as const;
/** The stone plinth at a wall's foot: its height, and how far it stands out from the wall. */
const PLINTH = { height: 0.9, depth: 0.1, color: 0x6f675c } as const;
const PARAPET = { height: 0.7, width: 0.3 } as const;
const FLAT_ROOF_COLOR = 0x9b9a92;
const PARAPET_COLOR = 0xc9c3b6;
const METAL_ROOF_COLOR = 0x7d8894;
const ROOF_OVERHANG_METERS = 0.5;

/** `geometry` in one colour for the details' merged mesh: a colour attribute, no uv. */
export function coloured(geometry: BufferGeometry, hex: number): BufferGeometry {
  const color = new Color(hex);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    color.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  if (geometry.getAttribute('uv') !== undefined) {
    geometry.deleteAttribute('uv');
  }
  return geometry.index === null ? geometry : geometry.toNonIndexed();
}

/**
 * The style a building gets: small ones mostly tiled hips, large ones flat
 * or, some, a metal gable; out in the country, tiled hips and gables only.
 * Deterministic.
 */
export function roofStyleOf(box: BuildingObstacle, random: SeededRandom): RoofStyle {
  const area = (box.maxX - box.minX) * (box.maxZ - box.minZ);
  const roll = random.next();
  if (box.country === true) {
    // Out in the country: houses under tiled hips, barns and halls under pitched roofs, and nothing on them.
    return area < 350 ? 'hip' : 'gable';
  }
  if (area < 350) {
    return roll < 0.6 ? 'hip' : 'flat';
  }
  return roll < 0.35 ? 'gable' : 'flat';
}

/**
 * A hipped roof over `box` in clay tiles: four slopes rising `rise` meters
 * from eaves that overhang the walls, to a ridge along the building's
 * length. uv runs along the eaves and up each slope, a unit per
 * ROOF_TILE_METERS, for the tile texture; `tint` shades the whole roof.
 */
export function hipRoofGeometry(box: BuildingObstacle, rise: number, tint: Color): BufferGeometry {
  const o = ROOF_OVERHANG_METERS;
  const x0 = box.minX - o;
  const x1 = box.maxX + o;
  const z0 = box.minZ - o;
  const z1 = box.maxZ + o;
  const y = box.heightMeters;
  const top = y + rise;
  const alongX = x1 - x0 >= z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const half = (alongX ? z1 - z0 : x1 - x0) / 2;
  // The ridge's two ends (one point over a square building: a pyramid).
  const r0 = alongX ? new Vector3(Math.min(cx, x0 + half), top, cz) : new Vector3(cx, top, Math.min(cz, z0 + half));
  const r1 = alongX ? new Vector3(Math.max(cx, x1 - half), top, cz) : new Vector3(cx, top, Math.max(cz, z1 - half));
  const a = new Vector3(x0, y, z0);
  const b = new Vector3(x1, y, z0);
  const c = new Vector3(x1, y, z1);
  const d = new Vector3(x0, y, z1);
  const builder = new FaceBuilder(tint, new Vector3(cx, y, cz));
  if (alongX) {
    builder.slope(a, b, [r1, r0]);
    builder.slope(c, d, [r0, r1]);
    builder.slope(d, a, [r0]);
    builder.slope(b, c, [r1]);
  } else {
    builder.slope(b, c, [r1, r0]);
    builder.slope(d, a, [r0, r1]);
    builder.slope(a, b, [r0]);
    builder.slope(c, d, [r1]);
  }
  return builder.build();
}

/**
 * A shallow gable of corrugated metal along `box`'s length, overhanging a
 * little, with its two gable ends filled in `wall`'s colour. Coloured, no
 * uv, for the details' mesh.
 */
export function gableRoofGeometry(box: BuildingObstacle, rise: number, wall: Color): BufferGeometry {
  const o = ROOF_OVERHANG_METERS * 0.6;
  const y = box.heightMeters;
  const alongX = box.maxX - box.minX >= box.maxZ - box.minZ;
  const centre = new Vector3((box.minX + box.maxX) / 2, y, (box.minZ + box.maxZ) / 2);
  const roof = new FaceBuilder(new Color(METAL_ROOF_COLOR), centre, false);
  const ends = new FaceBuilder(wall, centre, false);
  if (alongX) {
    const cz = (box.minZ + box.maxZ) / 2;
    const r0 = new Vector3(box.minX - o, y + rise, cz);
    const r1 = new Vector3(box.maxX + o, y + rise, cz);
    roof.slope(new Vector3(box.minX - o, y, box.minZ - o), new Vector3(box.maxX + o, y, box.minZ - o), [r1, r0]);
    roof.slope(new Vector3(box.maxX + o, y, box.maxZ + o), new Vector3(box.minX - o, y, box.maxZ + o), [r0, r1]);
    ends.slope(new Vector3(box.minX, y, box.maxZ), new Vector3(box.minX, y, box.minZ), [new Vector3(box.minX, y + rise, cz)]);
    ends.slope(new Vector3(box.maxX, y, box.minZ), new Vector3(box.maxX, y, box.maxZ), [new Vector3(box.maxX, y + rise, cz)]);
  } else {
    const cx = (box.minX + box.maxX) / 2;
    const r0 = new Vector3(cx, y + rise, box.minZ - o);
    const r1 = new Vector3(cx, y + rise, box.maxZ + o);
    roof.slope(new Vector3(box.maxX + o, y, box.minZ - o), new Vector3(box.maxX + o, y, box.maxZ + o), [r1, r0]);
    roof.slope(new Vector3(box.minX - o, y, box.maxZ + o), new Vector3(box.minX - o, y, box.minZ - o), [r0, r1]);
    ends.slope(new Vector3(box.minX, y, box.minZ), new Vector3(box.maxX, y, box.minZ), [new Vector3(cx, y + rise, box.minZ)]);
    ends.slope(new Vector3(box.maxX, y, box.maxZ), new Vector3(box.minX, y, box.maxZ), [new Vector3(cx, y + rise, box.maxZ)]);
  }
  return mergeFlat([roof.build(), ends.build()]);
}

/** The stone plinth round a building's foot: four slabs standing a little proud of the walls. Coloured, no uv. */
export function plinthGeometry(box: BuildingObstacle): BufferGeometry[] {
  return edgeBoxes(box, PLINTH.depth, PLINTH.height, 0, PLINTH.color, 0);
}

/**
 * A flat roof: its membrane over the walls' top, and a parapet round it.
 * Coloured, no uv.
 */
export function flatRoofGeometry(box: BuildingObstacle): BufferGeometry[] {
  const width = box.maxX - box.minX;
  const depth = box.maxZ - box.minZ;
  const slab = coloured(
    new BoxGeometry(width, 0.3, depth).translate(box.minX + width / 2, box.heightMeters - 0.1, box.minZ + depth / 2),
    FLAT_ROOF_COLOR,
  );
  return [slab, ...edgeBoxes(box, PARAPET.width, PARAPET.height, box.heightMeters, PARAPET_COLOR, -PARAPET.width / 2)];
}

/**
 * What stands on a flat roof, by the building's size: on a small one, water
 * tanks and solar water heaters (a tilted blue panel with its white tank
 * above it) facing the sun's `bearing` (radians from +z toward +x); on a
 * large one, air-conditioning plant, skylight strips and vent pipes.
 * Coloured, no uv.
 */
export function rooftopGeometry(box: BuildingObstacle, random: SeededRandom, bearing: number): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const width = box.maxX - box.minX;
  const depth = box.maxZ - box.minZ;
  const y = box.heightMeters + 0.05;
  const margin = 1.6;
  const spot = (): [number, number] => [
    box.minX + margin + random.next() * Math.max(0, width - 2 * margin),
    box.minZ + margin + random.next() * Math.max(0, depth - 2 * margin),
  ];
  if (width * depth < 350) {
    for (let i = random.int(1, 2); i > 0; i--) {
      const [x, z] = spot();
      parts.push(coloured(new CylinderGeometry(0.55, 0.55, 1.1, 10).translate(x, y + 0.55, z), 0xdfe4e6));
      parts.push(coloured(new CylinderGeometry(0.3, 0.55, 0.18, 10).translate(x, y + 1.19, z), 0xc4ccd0));
    }
    for (let i = random.int(1, 3); i > 0; i--) {
      const [x, z] = spot();
      parts.push(...solarHeater(x, y, z, bearing));
    }
  } else {
    for (let i = random.int(2, 5); i > 0; i--) {
      const [x, z] = spot();
      const turn = random.next() < 0.5 ? 0 : Math.PI / 2;
      parts.push(coloured(new BoxGeometry(2.2, 1.1, 1.4).rotateY(turn).translate(x, y + 0.55, z), 0xb7bcc0));
      parts.push(coloured(new CylinderGeometry(0.45, 0.45, 0.06, 10).translate(x, y + 1.13, z), 0x3a3f44));
    }
    const alongX = width >= depth;
    for (let i = random.int(1, 3); i > 0; i--) {
      const [x, z] = spot();
      const length = (alongX ? width : depth) * random.range(0.25, 0.45);
      const skylight = alongX ? new BoxGeometry(length, 0.35, 1.4) : new BoxGeometry(1.4, 0.35, length);
      parts.push(coloured(skylight.translate(alongX ? box.minX + width / 2 : x, y + 0.17, alongX ? z : box.minZ + depth / 2), 0x9fb6c6));
    }
    for (let i = random.int(1, 3); i > 0; i--) {
      const [x, z] = spot();
      parts.push(coloured(new CylinderGeometry(0.18, 0.18, 1.6, 8).translate(x, y + 0.8, z), 0x8d9398));
    }
  }
  return parts;
}

/**
 * A building with a form of its own (BuildingObstacle.form), standing in its box in place of walls and a roof: a
 * silo, a chimney or a mine's headframe. Coloured, no uv.
 */
export function formGeometry(box: BuildingObstacle): BufferGeometry[] {
  switch (box.form) {
    case 'silo':
      return siloGeometry(box);
    case 'chimney':
      return chimneyGeometry(box);
    case 'headframe':
      return headframeGeometry(box);
    case 'containers':
      return containersGeometry(box);
    case 'lighthouse':
      return lighthouseGeometry(box);
    default:
      return [];
  }
}

const SILO_STEEL = 0xb9bec2;
const SILO_CONCRETE = 0xcfc8b8;
const SILO_RING_METERS = 1.6;
const FOOTING_COLOR = 0x8f8a80;

/**
 * A silo: a ribbed drum, galvanised or concrete (by where it stands), a cone
 * roof with its cap, a ladder's rails up its side, on a concrete footing.
 */
function siloGeometry(box: BuildingObstacle): BufferGeometry[] {
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.minZ + box.maxZ) / 2;
  const radius = Math.min(box.maxX - box.minX, box.maxZ - box.minZ) / 2 - 0.3;
  const rise = radius * 0.55;
  const drum = box.heightMeters - rise;
  const wall = Math.floor(cx + cz) % 2 === 0 ? SILO_STEEL : SILO_CONCRETE;
  const ring = new Color(wall).multiplyScalar(0.84).getHex();
  const parts = [
    coloured(new CylinderGeometry(radius + 0.3, radius + 0.35, 0.5, 20).translate(cx, 0.25, cz), FOOTING_COLOR),
    coloured(new CylinderGeometry(radius, radius, drum, 20, 1, true).translate(cx, drum / 2, cz), wall),
    coloured(new CylinderGeometry(0.35, radius + 0.15, rise, 20).translate(cx, drum + rise / 2, cz), 0xa3a9ae),
    coloured(new CylinderGeometry(0.45, 0.45, 0.5, 10).translate(cx, drum + rise + 0.15, cz), 0x8d9398),
  ];
  for (let y = SILO_RING_METERS; y < drum - 0.4; y += SILO_RING_METERS) {
    parts.push(coloured(new CylinderGeometry(radius + 0.05, radius + 0.05, 0.1, 20, 1, true).translate(cx, y, cz), ring));
  }
  for (const side of [-0.25, 0.25]) {
    parts.push(coloured(new BoxGeometry(0.06, drum, 0.06).translate(cx + radius + 0.18, drum / 2, cz + side), 0x6f757a));
  }
  return parts;
}

/**
 * A works' chimney: a brick shaft narrowing as it rises, red and white
 * bands near its top for aircraft, a dark cap, on a concrete base.
 */
function chimneyGeometry(box: BuildingObstacle): BufferGeometry[] {
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.minZ + box.maxZ) / 2;
  const height = box.heightMeters;
  const foot = Math.min(box.maxX - box.minX, box.maxZ - box.minZ) / 2 - 1;
  const top = foot * 0.6;
  const radiusAt = (y: number): number => foot + ((top - foot) * y) / height;
  const band = 1.1;
  const parts = [
    coloured(new BoxGeometry(2 * foot + 1.4, 2.2, 2 * foot + 1.4).translate(cx, 1.1, cz), FOOTING_COLOR),
    coloured(new CylinderGeometry(top, foot, height, 16, 1, true).translate(cx, height / 2, cz), 0x8b4a37),
    coloured(new CylinderGeometry(top + 0.15, top + 0.15, 0.6, 16).translate(cx, height + 0.1, cz), 0x3b3530),
  ];
  [0xe8e4dc, 0xb5322a, 0xe8e4dc].forEach((hex, i) => {
    const y = height - 1.2 - band * (i + 0.5);
    const radius = radiusAt(y) + 0.04;
    parts.push(coloured(new CylinderGeometry(radius, radius + 0.02, band, 16, 1, true).translate(cx, y, cz), hex));
  });
  return parts;
}

/**
 * A lighthouse on a headland: a white tower narrowing up, in red bands, on a
 * stone footing; a dark gallery round its top, the lantern's glass over it
 * and a red dome with its vent.
 */
function lighthouseGeometry(box: BuildingObstacle): BufferGeometry[] {
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.minZ + box.maxZ) / 2;
  const foot = Math.min(box.maxX - box.minX, box.maxZ - box.minZ) / 2 - 0.6;
  const lantern = 3.2;
  const tower = box.heightMeters - lantern - 1.6;
  const top = foot * 0.62;
  const radiusAt = (y: number): number => foot + ((top - foot) * y) / tower;
  const parts = [
    coloured(new CylinderGeometry(foot + 0.6, foot + 0.8, 1.2, 16).translate(cx, 0.6, cz), FOOTING_COLOR),
    coloured(new CylinderGeometry(top, foot, tower, 16, 1, true).translate(cx, tower / 2, cz), 0xf1efe9),
    coloured(new CylinderGeometry(top + 1.1, top + 0.9, 0.35, 16).translate(cx, tower + 0.1, cz), 0x2f3336),
    coloured(new CylinderGeometry(top * 0.7, top * 0.7, lantern, 12, 1, true).translate(cx, tower + 0.3 + lantern / 2, cz), 0xf6dd8a),
    coloured(new ConeGeometry(top * 0.82, 1.4, 12).translate(cx, tower + 0.3 + lantern + 0.7, cz), 0xb5322a),
    coloured(new CylinderGeometry(0.18, 0.18, 0.6, 6).translate(cx, tower + 0.3 + lantern + 1.5, cz), 0x2f3336),
  ];
  // Two red bands round the tower.
  for (const share of [0.32, 0.66]) {
    const band = tower * 0.13;
    const y = tower * share;
    parts.push(coloured(new CylinderGeometry(radiusAt(y + band / 2) + 0.04, radiusAt(y - band / 2) + 0.04, band, 16, 1, true).translate(cx, y, cz), 0xb5322a));
  }
  return parts;
}

const HEADFRAME_STEEL = 0x7a3b2b;
const HEADFRAME_BAY_METERS = 5;

/**
 * A mine's headframe over its shaft: a braced steel tower of four legs, two
 * raking struts back to the ground, a platform, and the two sheave wheels
 * the hoist's ropes run over.
 */
function headframeGeometry(box: BuildingObstacle): BufferGeometry[] {
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.minZ + box.maxZ) / 2;
  const half = Math.min(box.maxX - box.minX, box.maxZ - box.minZ) / 4;
  const tower = box.heightMeters - 4;
  const parts: BufferGeometry[] = [coloured(new BoxGeometry(4 * half, 0.6, 4 * half).translate(cx, 0.3, cz), FOOTING_COLOR)];
  const steel = (geometry: BufferGeometry): void => {
    parts.push(coloured(geometry, HEADFRAME_STEEL));
  };
  // A member from (x0, y0, z0) to (x1, y1, z1), `thickness` square.
  const member = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, thickness: number): void => {
    const from = new Vector3(x0, y0, z0);
    const along = new Vector3(x1, y1, z1).sub(from);
    const length = along.length();
    // Built along z, then turned so its z runs along the member (never upright: the posts are boxes of their own).
    const geometry = new BoxGeometry(thickness, thickness, length);
    geometry.lookAt(along);
    steel(geometry.translate(x0 + along.x / 2, y0 + along.y / 2, z0 + along.z / 2));
  };
  const corners: readonly [number, number][] = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ];
  for (const [x, z] of corners) {
    steel(new BoxGeometry(0.5, tower, 0.5).translate(cx + x, tower / 2, cz + z));
  }
  for (let y = HEADFRAME_BAY_METERS; y <= tower; y += HEADFRAME_BAY_METERS) {
    for (let side = 0; side < 4; side++) {
      const [x0, z0] = corners[side]!;
      const [x1, z1] = corners[(side + 1) % 4]!;
      member(cx + x0, y, cz + z0, cx + x1, y, cz + z1, 0.3);
      // An X across each face of the bay below (the lowest from just off the footing).
      const low = Math.max(y - HEADFRAME_BAY_METERS, 0.6);
      member(cx + x0, low, cz + z0, cx + x1, y, cz + z1, 0.16);
      member(cx + x1, low, cz + z1, cx + x0, y, cz + z0, 0.16);
    }
  }
  // The raking struts, from the tower's top back to the ground toward the winding house (-x).
  for (const z of [-half, half]) {
    member(cx - half, tower, cz + z, cx - 3.4 * half, 0.3, cz + z * 1.4, 0.55);
  }
  steel(new BoxGeometry(2 * half + 2, 0.4, 2 * half + 2).translate(cx, tower, cz));
  for (const z of [-0.9, 0.9]) {
    parts.push(coloured(new CylinderGeometry(1.9, 1.9, 0.3, 20).rotateX(Math.PI / 2).translate(cx, tower + 2.3, cz + z), 0x3d3a37));
    parts.push(coloured(new CylinderGeometry(0.45, 0.45, 0.4, 10).rotateX(Math.PI / 2).translate(cx, tower + 2.3, cz + z), 0x9a9690));
  }
  steel(new BoxGeometry(0.4, 2.3, 2.6).translate(cx, tower + 1.15, cz));
  return parts;
}

/** The length of `box`'s wall on `side`. */
function wallLength(box: BuildingObstacle, side: BuildingSide): number {
  return side === '-x' || side === '+x' ? box.maxZ - box.minZ : box.maxX - box.minX;
}

/**
 * Parts built against a wall in its own frame (along it x, up y, out from it z, the wall's middle at the origin)
 * turned and moved onto `side` of `box`.
 */
function onWall(box: BuildingObstacle, side: BuildingSide, parts: BufferGeometry[]): BufferGeometry[] {
  const turn = side === '+z' ? 0 : side === '-z' ? Math.PI : side === '+x' ? Math.PI / 2 : -Math.PI / 2;
  const x = side === '-x' ? box.minX : side === '+x' ? box.maxX : (box.minX + box.maxX) / 2;
  const z = side === '-z' ? box.minZ : side === '+z' ? box.maxZ : (box.minZ + box.maxZ) / 2;
  return parts.map((part) => part.rotateY(turn).translate(x, 0, z));
}

/** A box in a wall's frame: `width` along it about `along`, from `bottom` up `height`, `depth` out from `out`. */
function wallBox(along: number, width: number, bottom: number, height: number, out: number, depth: number, hex: number): BufferGeometry {
  return coloured(new BoxGeometry(width, height, depth).translate(along, bottom + height / 2, out + depth / 2), hex);
}

/** Shop fascias and awnings: original, plain colours. */
const FASCIA_PAINTS = [0x2f5d8a, 0x8a2f2f, 0x3f6b45, 0x2b2e31, 0x7a5a2f, 0x5c3f6b] as const;
const AWNING_PAINTS = [0xb5322a, 0x2f6d8a, 0x3f7b4a, 0xc76f2a] as const;
const AWNING_STRIPE = 0xece8de;
const SHOP_GLASS = 0x34424e;
const SHOP_FRAME = 0x2b2e31;
/** A shop is about this wide along its building's front, meters. */
const SHOP_WIDTH_METERS = 9;

/**
 * Shops along the ground floor of a town building's `side` facing its street: each a glazed front on a low riser
 * under a lintel, its door at one end, a painted fascia board over it (no lettering), and most under a striped
 * awning. Over the facade's ground-floor windows (3.5 m a floor). Coloured, no uv.
 */
export function shopfrontGeometry(box: BuildingObstacle, side: BuildingSide, random: SeededRandom): BufferGeometry[] {
  const length = wallLength(box, side);
  const shops = Math.max(1, Math.round(length / SHOP_WIDTH_METERS));
  const each = length / shops;
  const parts: BufferGeometry[] = [];
  for (let shop = 0; shop < shops; shop++) {
    const along = -length / 2 + each * (shop + 0.5);
    const width = each - 0.9;
    parts.push(
      wallBox(along, width + 0.2, 0, 0.35, 0, 0.14, SHOP_FRAME),
      wallBox(along, width, 0.35, 2.2, 0, 0.06, SHOP_GLASS),
      wallBox(along + width / 2 - 0.75, 1, 0.35, 2.2, 0.06, 0.05, 0x1f2428),
      wallBox(along, width + 0.2, 2.55, 0.15, 0, 0.14, SHOP_FRAME),
      wallBox(along, width + 0.2, 2.7, 0.6, 0, 0.16, FASCIA_PAINTS[random.int(0, FASCIA_PAINTS.length - 1)]!),
    );
    if (random.next() < 0.7) {
      const paint = AWNING_PAINTS[random.int(0, AWNING_PAINTS.length - 1)]!;
      const stripes = 6;
      const stripe = width / stripes;
      for (let i = 0; i < stripes; i++) {
        const awning = new BoxGeometry(stripe, 0.05, 1.3).rotateX(0.35).translate(along - width / 2 + stripe * (i + 0.5), 2.42, 0.72);
        parts.push(coloured(awning, i % 2 === 0 ? paint : AWNING_STRIPE));
      }
    }
  }
  return onWall(box, side, parts);
}

/**
 * Loading doors in a warehouse's or a barn's `side` facing its road: roller shutters in steel frames, a canopy over
 * each, and a yellow bollard either side. Coloured, no uv.
 */
export function loadingDoorsGeometry(box: BuildingObstacle, side: BuildingSide): BufferGeometry[] {
  const length = wallLength(box, side);
  const doors = Math.min(4, Math.max(1, Math.floor(length / 10)));
  const width = Math.min(4.2, length / doors - 2);
  const height = Math.min(4.8, box.heightMeters - 1.5);
  if (width < 2 || height < 2.5) {
    return [];
  }
  const parts: BufferGeometry[] = [];
  for (let door = 0; door < doors; door++) {
    const along = -length / 2 + (length / doors) * (door + 0.5);
    parts.push(
      wallBox(along, width, 0, height, 0, 0.08, 0x5d6a74),
      wallBox(along - width / 2 - 0.1, 0.2, 0, height, 0, 0.14, 0x3a3f44),
      wallBox(along + width / 2 + 0.1, 0.2, 0, height, 0, 0.14, 0x3a3f44),
      wallBox(along, width + 0.4, height, 0.3, 0, 0.14, 0x3a3f44),
      wallBox(along, width + 1, height + 0.55, 0.12, 0, 1.4, 0x7d8894),
    );
    for (const end of [-1, 1]) {
      parts.push(wallBox(along + end * (width / 2 + 0.6), 0.25, 0, 1, 0.5, 0.25, 0xd8b02a));
    }
  }
  return onWall(box, side, parts);
}

const DOOR_PAINTS = [0x5a3a28, 0x2f4f6b, 0x3f5f3f, 0x7a2f2f] as const;

/**
 * A country house's front door on its `side` facing the lane: a panelled door on a stone step under a small
 * canopy, somewhere along the wall. Coloured, no uv.
 */
export function frontDoorGeometry(box: BuildingObstacle, side: BuildingSide, random: SeededRandom): BufferGeometry[] {
  const length = wallLength(box, side);
  const along = random.range(-length / 4, length / 4);
  return onWall(box, side, [
    wallBox(along, 1.7, 0, 0.3, 0, 0.8, 0x8f8a80),
    wallBox(along, 1, 0.3, 2.15, 0, 0.08, DOOR_PAINTS[random.int(0, DOOR_PAINTS.length - 1)]!),
    wallBox(along, 1.6, 2.6, 0.1, 0, 0.9, 0x6b5545),
  ]);
}

/**
 * A brick chimney stack rising through a pitched roof `rise` high: over the ridge, a quarter of the way along from
 * one end, with its cap. Coloured, no uv.
 */
export function chimneyStackGeometry(box: BuildingObstacle, rise: number, random: SeededRandom): BufferGeometry[] {
  const width = box.maxX - box.minX;
  const depth = box.maxZ - box.minZ;
  const end = random.next() < 0.5 ? -0.25 : 0.25;
  const x = (box.minX + box.maxX) / 2 + (width >= depth ? end * width : 0);
  const z = (box.minZ + box.maxZ) / 2 + (width >= depth ? 0 : end * depth);
  const bottom = box.heightMeters - 0.3;
  const top = box.heightMeters + rise * 0.8 + 0.9;
  return [
    coloured(new BoxGeometry(0.6, top - bottom, 0.6).translate(x, (top + bottom) / 2, z), 0x8b4a37),
    coloured(new BoxGeometry(0.8, 0.12, 0.8).translate(x, top + 0.06, z), 0x5a5048),
  ];
}

/** Shipping containers' paint: original, plain colours of no line in particular. */
const CONTAINER_PAINTS = [0x9c3b2e, 0x2f5d8a, 0x3f6b45, 0x8a8f94, 0xc76f2a, 0xd9d6cf, 0x6b4a33] as const;

/**
 * A stack of shipping containers filling its box: end to end along its length, side by side across it, as many high
 * as it is tall; now and then a column one short, each container its own paint (from where it stands, so the same
 * every drive), with a darker band along its foot where its frame is.
 */
function containersGeometry(box: BuildingObstacle): BufferGeometry[] {
  const sizeX = box.maxX - box.minX;
  const sizeZ = box.maxZ - box.minZ;
  const alongX = sizeX >= sizeZ;
  const length = alongX ? sizeX : sizeZ;
  const width = alongX ? sizeZ : sizeX;
  const { length: unit, width: across, height } = CONTAINER_METERS;
  const ends = Math.max(1, Math.round((length + CONTAINER_GAP_METERS) / (unit + CONTAINER_GAP_METERS)));
  const sides = Math.max(1, Math.round((width + CONTAINER_GAP_METERS) / (across + CONTAINER_GAP_METERS)));
  const tiers = Math.max(1, Math.round(box.heightMeters / height));
  const parts: BufferGeometry[] = [];
  const seed = Math.floor(box.minX * 7 + box.minZ * 13);
  for (let end = 0; end < ends; end++) {
    for (let side = 0; side < sides; side++) {
      const column = hash(seed + end * 31 + side * 17);
      const high = tiers > 1 && column % 5 === 0 ? tiers - 1 : tiers;
      for (let tier = 0; tier < high; tier++) {
        const paint = CONTAINER_PAINTS[hash(column + tier * 101) % CONTAINER_PAINTS.length]!;
        const a = -length / 2 + unit / 2 + end * (unit + CONTAINER_GAP_METERS);
        const b = -width / 2 + across / 2 + side * (across + CONTAINER_GAP_METERS);
        const x = (box.minX + box.maxX) / 2 + (alongX ? a : b);
        const z = (box.minZ + box.maxZ) / 2 + (alongX ? b : a);
        const y = tier * height;
        const shell = alongX ? new BoxGeometry(unit, height - 0.04, across) : new BoxGeometry(across, height - 0.04, unit);
        parts.push(coloured(shell.translate(x, y + height / 2, z), paint));
        const rail = alongX ? new BoxGeometry(unit + 0.02, 0.16, across + 0.02) : new BoxGeometry(across + 0.02, 0.16, unit + 0.02);
        parts.push(coloured(rail.translate(x, y + 0.08, z), new Color(paint).multiplyScalar(0.55).getHex()));
      }
    }
  }
  return parts;
}

/** A small integer hash: the same number for the same input, scattered. */
function hash(value: number): number {
  let h = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A solar water heater standing at (x, y, z), its panel tilted toward `bearing`: frame, blue panel, white tank on legs. */
function solarHeater(x: number, y: number, z: number, bearing: number): BufferGeometry[] {
  const tilt = (38 * Math.PI) / 180;
  const panel = new BoxGeometry(1.9, 0.06, 1.25).rotateX(-tilt).translate(0, 0.62, 0);
  const tank = new CylinderGeometry(0.26, 0.26, 1.9, 10).rotateZ(Math.PI / 2).translate(0, 1.18, -0.62);
  const legs = [new BoxGeometry(0.06, 1.1, 0.06).translate(-0.85, 0.55, -0.55), new BoxGeometry(0.06, 1.1, 0.06).translate(0.85, 0.55, -0.55)];
  // Built facing +z; turned to face the sun.
  return [coloured(panel, 0x243a5e), coloured(tank, 0xecece6), ...legs.map((leg) => coloured(leg, 0x9aa0a6))].map((part) =>
    part.rotateY(bearing).translate(x, y, z),
  );
}

/** Four boxes along `box`'s edges, `thickness` deep and `height` tall from `y`, their centres `inset` in from the walls. */
function edgeBoxes(box: BuildingObstacle, thickness: number, height: number, y: number, color: number, inset: number): BufferGeometry[] {
  const width = box.maxX - box.minX;
  const depth = box.maxZ - box.minZ;
  const out = thickness / 2 + inset;
  const cx = box.minX + width / 2;
  const cz = box.minZ + depth / 2;
  const middle = y + height / 2;
  return [
    new BoxGeometry(width + 2 * out + thickness, height, thickness).translate(cx, middle, box.minZ - out),
    new BoxGeometry(width + 2 * out + thickness, height, thickness).translate(cx, middle, box.maxZ + out),
    new BoxGeometry(thickness, height, depth + 2 * out - thickness).translate(box.minX - out, middle, cz),
    new BoxGeometry(thickness, height, depth + 2 * out - thickness).translate(box.maxX + out, middle, cz),
  ].map((part) => coloured(part, color));
}

/** Non-indexed parts with the same attributes, merged by concatenation. */
function mergeFlat(parts: readonly BufferGeometry[]): BufferGeometry {
  const merged = new BufferGeometry();
  for (const name of Object.keys(parts[0]!.attributes)) {
    const size = parts[0]!.getAttribute(name).itemSize;
    const total = parts.reduce((sum, part) => sum + part.getAttribute(name).array.length, 0);
    const array = new Float32Array(total);
    let at = 0;
    for (const part of parts) {
      array.set(part.getAttribute(name).array as Float32Array, at);
      at += part.getAttribute(name).array.length;
    }
    merged.setAttribute(name, new BufferAttribute(array, size));
  }
  for (const part of parts) {
    part.dispose();
  }
  return merged;
}

/**
 * Builds roof faces as flat-shaded triangles: each slope from its eave (two
 * corners) up to one ridge point (a hip's end, a gable's apex) or two (a
 * slope along the ridge). Every face is wound to face away from `centre`,
 * the building's middle at the eaves; uv (when kept) runs along the eave
 * and up the slope in ROOF_TILE_METERS.
 */
class FaceBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly colors: number[] = [];

  constructor(
    private readonly color: Color,
    private readonly centre: Vector3,
    private readonly withUv = true,
  ) {}

  slope(left: Vector3, right: Vector3, ridge: readonly Vector3[]): void {
    const along = new Vector3().subVectors(right, left).normalize();
    const corners = ridge.length === 1 ? [left, right, ridge[0]!] : [left, right, ridge[0]!, left, ridge[0]!, ridge[1]!];
    for (let i = 0; i < corners.length; i += 3) {
      let [a, b, c] = [corners[i]!, corners[i + 1]!, corners[i + 2]!];
      const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize();
      const middle = new Vector3().add(a).add(b).add(c).divideScalar(3).sub(this.centre);
      if (normal.dot(middle) < 0) {
        [b, c] = [c, b];
        normal.negate();
      }
      for (const point of [a, b, c]) {
        this.positions.push(point.x, point.y, point.z);
        this.normals.push(normal.x, normal.y, normal.z);
        this.colors.push(this.color.r, this.color.g, this.color.b);
        const offset = new Vector3().subVectors(point, left);
        const u = offset.dot(along);
        const up = offset.sub(along.clone().multiplyScalar(u)).length();
        this.uvs.push(u / ROOF_TILE_METERS.along, up / ROOF_TILE_METERS.up);
      }
    }
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    if (this.withUv) {
      geometry.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2));
    }
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 3));
    return geometry;
  }
}
