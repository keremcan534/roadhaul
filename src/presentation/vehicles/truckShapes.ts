import { BufferAttribute, BufferGeometry, CylinderGeometry, LatheGeometry, Shape, ShapeGeometry, ShapeUtils, Vector2 } from 'three';

/** A point in a plane: (x, z) for an outline seen from above, (z, y) for a profile seen from the side. */
export type Point2 = readonly [number, number];

/** A profile turning by more than this (the cosine of 40°) at a point is creased there, not smoothed. */
const CREASE_COSINE = Math.cos((40 * Math.PI) / 180);

/**
 * A rectangle seen from above (x across, z along the truck), from
 * -`halfWidth` to `halfWidth` and `zMin` to `zMax`, its front corners (at
 * `zMax`) rounded by `front` and its rear ones by `rear`, each corner in
 * `segments` steps. It runs from +x round the front to -x (clockwise seen
 * from above); the same number of points for any size, so outlines of one
 * shape can be lofted into one another.
 */
export function roundedOutline(
  halfWidth: number,
  zMin: number,
  zMax: number,
  front: number,
  rear: number,
  segments = 4,
): Point2[] {
  const points: Point2[] = [];
  const corner = (cx: number, cz: number, radius: number, from: number): void => {
    for (let i = 0; i <= segments; i++) {
      const angle = from + (i / segments) * (Math.PI / 2);
      points.push([cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius]);
    }
  };
  // The +x front corner, the -x front corner, the -x rear corner, the +x rear corner.
  corner(halfWidth - front, zMax - front, front, 0);
  corner(-halfWidth + front, zMax - front, front, Math.PI / 2);
  corner(-halfWidth + rear, zMin + rear, rear, Math.PI);
  corner(halfWidth - rear, zMin + rear, rear, (3 * Math.PI) / 2);
  return points;
}

/** One ring of a loft: an outline (see roundedOutline) at height `y`. */
export interface LoftRing {
  readonly outline: readonly Point2[];
  readonly y: number;
}

/**
 * The walls through `rings` (bottom to top, each outline with the same
 * number of points), facing outward, smooth-shaded round the corners and
 * between the rings; with `top`, a flat lid on the last ring. No bottom: the
 * truck's shells are open underneath. Indexed, with uvs (zero), so it merges
 * with boxes.
 */
export function loft(rings: readonly LoftRing[], options: { readonly top?: boolean } = {}): BufferGeometry {
  const count = rings[0]!.outline.length;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const ring of rings) {
    for (const [x, z] of ring.outline) {
      positions.push(x, ring.y, z);
    }
  }
  for (let r = 0; r + 1 < rings.length; r++) {
    for (let i = 0; i < count; i++) {
      const a = r * count + i;
      const b = r * count + ((i + 1) % count);
      const c = a + count;
      const d = b + count;
      // The outline runs clockwise seen from above: (a, d, b) winds anticlockwise seen from outside.
      indices.push(a, d, b, a, c, d);
    }
  }
  const walls = indexedGeometry(positions, indices);
  walls.computeVertexNormals();
  if (options.top !== true) {
    return walls;
  }
  const last = rings[rings.length - 1]!;
  const lid = flatPolygon(last.outline, last.y, 1);
  const merged = joinIndexed([walls, lid]);
  walls.dispose();
  lid.dispose();
  return merged;
}

/**
 * The flat band between an `outer` and an `inner` outline (the same number
 * of points) at height `y`, facing up: a ledge round the foot of a
 * glasshouse.
 */
export function ledge(outer: readonly Point2[], inner: readonly Point2[], y: number): BufferGeometry {
  const count = outer.length;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [x, z] of outer) {
    positions.push(x, y, z);
  }
  for (const [x, z] of inner) {
    positions.push(x, y, z);
  }
  for (let i = 0; i < count; i++) {
    const a = i;
    const b = (i + 1) % count;
    const c = a + count;
    const d = b + count;
    indices.push(a, c, d, a, d, b);
  }
  const geometry = indexedGeometry(positions, indices);
  setNormal(geometry, 0, 1, 0);
  return geometry;
}

/**
 * A flat polygon from a convex `outline` seen from above, at height `y`,
 * facing up (`facing` 1) or down (-1).
 */
export function flatPolygon(outline: readonly Point2[], y: number, facing: 1 | -1): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [x, z] of outline) {
    positions.push(x, y, z);
  }
  for (let i = 1; i + 1 < outline.length; i++) {
    // The outline runs clockwise seen from above: (0, i+1, i) faces up.
    if (facing === 1) {
      indices.push(0, i + 1, i);
    } else {
      indices.push(0, i, i + 1);
    }
  }
  const geometry = indexedGeometry(positions, indices);
  setNormal(geometry, 0, facing, 0);
  return geometry;
}

/**
 * A solid of a side `profile` (z along the truck, y up; any order round the
 * shape) running across the truck from -`halfWidth` to `halfWidth`: a roof
 * fairing. Its band is smooth-shaded, its two sides flat.
 */
export function extrudeAcross(profile: readonly Point2[], halfWidth: number): BufferGeometry {
  // Anticlockwise seen from the left (+x), where z runs to the left and y up: then the left side faces +x.
  const contour = profile.map(([z, y]) => new Vector2(-z, y));
  const clockwise = ShapeUtils.isClockWise(contour);
  const ordered = clockwise ? [...profile].reverse() : [...profile];
  const count = ordered.length;
  // Each edge's outward normal (z, y): to the right of the way it runs, on a contour anticlockwise seen from +x.
  const edgeNormals = ordered.map(([z0, y0], i): Point2 => {
    const [z1, y1] = ordered[(i + 1) % count]!;
    const length = Math.hypot(z1 - z0, y1 - y0) || 1;
    return [-(y1 - y0) / length, (z1 - z0) / length];
  });
  // Smooth round gentle bends, sharp at corners.
  const vertexNormal = (vertex: number, edge: number): Point2 => {
    const before = edgeNormals[(vertex - 1 + count) % count]!;
    const after = edgeNormals[vertex % count]!;
    if (before[0] * after[0] + before[1] * after[1] < CREASE_COSINE) {
      return edgeNormals[edge]!;
    }
    const length = Math.hypot(before[0] + after[0], before[1] + after[1]) || 1;
    return [(before[0] + after[0]) / length, (before[1] + after[1]) / length];
  };
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  // The band: a quad across the truck on each edge of the profile.
  for (let edge = 0; edge < count; edge++) {
    const base = positions.length / 3;
    const ends = [edge, (edge + 1) % count] as const;
    for (const side of [1, -1] as const) {
      for (const vertex of ends) {
        const [z, y] = ordered[vertex]!;
        const [nz, ny] = vertexNormal(vertex, edge);
        positions.push(side * halfWidth, y, z);
        normals.push(0, ny, nz);
      }
    }
    // +x start, +x end, -x start, -x end.
    indices.push(base, base + 2, base + 3, base, base + 3, base + 1);
  }
  const band = indexedGeometry(positions, indices);
  band.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  const sides: BufferGeometry[] = [band];
  const triangles = ShapeUtils.triangulateShape(
    ordered.map(([z, y]) => new Vector2(-z, y)),
    [],
  );
  for (const side of [1, -1] as const) {
    const sidePositions: number[] = [];
    const sideIndices: number[] = [];
    for (const [z, y] of ordered) {
      sidePositions.push(side * halfWidth, y, z);
    }
    for (const [a, b, c] of triangles) {
      // Wound to face out of this side: the normal's x, (b - a) × (c - a), has the side's sign.
      const [az, ay] = ordered[a!]!;
      const [bz, by] = ordered[b!]!;
      const [cz, cy] = ordered[c!]!;
      const normalX = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      if (Math.sign(normalX) === side) {
        sideIndices.push(a!, b!, c!);
      } else {
        sideIndices.push(a!, c!, b!);
      }
    }
    const face = indexedGeometry(sidePositions, sideIndices);
    setNormal(face, side, 0, 0);
    sides.push(face);
  }
  const merged = joinIndexed(sides);
  for (const part of sides) {
    part.dispose();
  }
  return merged;
}

/**
 * A panel on the truck's `side` (1 its left, +x; -1 its right) at
 * x = `side` · `x`, facing out: from `zRear` to `zFront` and `yBottom` to
 * `yTop`, with a round wheel arch of `archRadius` cut up from its bottom edge
 * round (`archZ`, `yBottom`).
 */
export function archedSkirt(
  side: 1 | -1,
  x: number,
  zRear: number,
  zFront: number,
  yBottom: number,
  yTop: number,
  archZ: number,
  archRadius: number,
): BufferGeometry {
  // Drawn in a plane whose first axis runs along the truck (flipped on the left, so it faces out once turned).
  const along = (z: number): number => (side === 1 ? -z : z);
  const shape = new Shape();
  shape.moveTo(along(zRear), yBottom);
  shape.lineTo(along(archZ - archRadius), yBottom);
  const steps = 12;
  for (let i = 1; i < steps; i++) {
    const angle = Math.PI - (i / steps) * Math.PI;
    shape.lineTo(along(archZ + Math.cos(angle) * archRadius), yBottom + Math.sin(angle) * archRadius);
  }
  shape.lineTo(along(archZ + archRadius), yBottom);
  shape.lineTo(along(zFront), yBottom);
  shape.lineTo(along(zFront), yTop);
  shape.lineTo(along(zRear), yTop);
  shape.closePath();
  // ShapeGeometry faces up its plane's third axis whichever way the shape runs: turned a quarter about y, it
  // looks out of the truck's side.
  const flat = new ShapeGeometry(shape);
  flat.rotateY((side * Math.PI) / 2).translate(side * x, 0, 0);
  setNormal(flat, side, 0, 0);
  return flat;
}

/**
 * A flat half ring round a wheel arch on the truck's `side` (1 its left, +x),
 * at x = `side` · `x`, facing out: from radius `inner` to `outer` round
 * (`z`, `y`), over the top.
 */
export function archTrim(side: 1 | -1, x: number, z: number, y: number, inner: number, outer: number): BufferGeometry {
  const along = (value: number): number => (side === 1 ? -value : value);
  const steps = 12;
  const shape = new Shape();
  shape.moveTo(along(z + outer), y);
  for (let i = 1; i <= steps; i++) {
    const angle = (i / steps) * Math.PI;
    shape.lineTo(along(z + Math.cos(angle) * outer), y + Math.sin(angle) * outer);
  }
  for (let i = steps; i >= 0; i--) {
    const angle = (i / steps) * Math.PI;
    shape.lineTo(along(z + Math.cos(angle) * inner), y + Math.sin(angle) * inner);
  }
  shape.closePath();
  const flat = new ShapeGeometry(shape);
  flat.rotateY((side * Math.PI) / 2).translate(side * x, 0, 0);
  setNormal(flat, side, 0, 0);
  return flat;
}

/**
 * The inside of a wheel arch: half a tube round the axle at (`z`, `y`), of
 * `radius`, from x = `x0` to `x1`, over the top, facing in toward the wheel.
 */
export function archLiner(x0: number, x1: number, z: number, y: number, radius: number): BufferGeometry {
  const length = Math.abs(x1 - x0);
  const tube = new CylinderGeometry(radius, radius, length, 14, 1, true, 0, Math.PI);
  // Its axis turned to run across the truck; the half with y above the axle is the one over the wheel.
  tube.rotateZ(Math.PI / 2).translate((x0 + x1) / 2, y, z);
  flipFaces(tube);
  return tube;
}

/**
 * A truck tyre round the x axis: `radius`, `width` wide, the tread flat and
 * the shoulders rounded, the sidewalls running in to the rim at
 * `rimRadius`, whose face stands `rimInset` in from the sidewall.
 */
export function tyreGeometry(radius: number, width: number, rimRadius: number, rimInset: number, segments = 24): BufferGeometry {
  const half = width / 2;
  const shoulder = Math.min(0.06, half * 0.4);
  // Lathe profile (distance from the axle, position along it), from the inside rim round to the outside one.
  const profile: Point2[] = [
    [rimRadius * 0.98, -half + rimInset],
    [rimRadius, -half],
    [radius - shoulder * 1.2, -half],
    [radius - shoulder * 0.35, -half + shoulder * 0.3],
    [radius, -half + shoulder],
    [radius, half - shoulder],
    [radius - shoulder * 0.35, half - shoulder * 0.3],
    [radius - shoulder * 1.2, half],
    [rimRadius, half],
    [rimRadius * 0.98, half - rimInset],
  ];
  const lathe = new LatheGeometry(
    profile.map(([r, along]) => new Vector2(r, along)),
    segments,
  );
  // The lathe turns round y: lay its axis along x.
  lathe.rotateZ(-Math.PI / 2);
  return lathe;
}

/** Turns every face of `geometry` to look the other way (winding and normals). */
export function flipFaces(geometry: BufferGeometry): BufferGeometry {
  const index = geometry.getIndex();
  if (index !== null) {
    const array = index.array;
    for (let i = 0; i < array.length; i += 3) {
      const second = array[i + 1]!;
      array[i + 1] = array[i + 2]!;
      array[i + 2] = second;
    }
    index.needsUpdate = true;
  }
  const normal = geometry.getAttribute('normal');
  if (normal !== undefined) {
    for (let i = 0; i < normal.count; i++) {
      normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i));
    }
    normal.needsUpdate = true;
  }
  return geometry;
}

function indexedGeometry(positions: readonly number[], indices: readonly number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(positions.length), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  geometry.setIndex([...indices]);
  return geometry;
}

function setNormal(geometry: BufferGeometry, x: number, y: number, z: number): void {
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < normal.count; i++) {
    normal.setXYZ(i, x, y, z);
  }
  normal.needsUpdate = true;
}

/** Indexed geometries with position, normal and uv, joined into one. */
function joinIndexed(parts: readonly BufferGeometry[]): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const part of parts) {
    const offset = positions.length / 3;
    positions.push(...(part.getAttribute('position').array as Float32Array));
    normals.push(...(part.getAttribute('normal').array as Float32Array));
    uvs.push(...(part.getAttribute('uv').array as Float32Array));
    for (const index of part.getIndex()!.array) {
      indices.push(index + offset);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  return geometry;
}
