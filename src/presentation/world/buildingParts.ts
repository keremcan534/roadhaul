import { BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, Vector3 } from 'three';
import type { SeededRandom } from '../../core/random/SeededRandom';
import type { BuildingObstacle } from '../../domain/world/DrivingWorld';

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

/** The style a building gets: small ones mostly tiled hips, large ones flat or, some, a metal gable. Deterministic. */
export function roofStyleOf(box: BuildingObstacle, random: SeededRandom): RoofStyle {
  const area = (box.maxX - box.minX) * (box.maxZ - box.minZ);
  const roll = random.next();
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
