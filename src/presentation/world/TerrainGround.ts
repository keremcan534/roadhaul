import { BufferAttribute, BufferGeometry, Color, Mesh, Vector4, type Material } from 'three';
import type { Terrain } from '../../domain/world/terrain';

/** The near ground's square, meters a side, and its vertices' spacing (the terrain grid's): fine where the truck is. */
export const NEAR_GROUND_METERS = 1024;
export const NEAR_GROUND_CELL_METERS = 8;
/** The far ground's vertices' spacing, meters: the whole map's hills, coarse, under the haze. */
export const FAR_GROUND_CELL_METERS = 80;
/** The near ground moves on once the camera is this far from its middle, meters (whole cells). */
const RECENTRE_METERS = 128;
/** The far ground is left out this far inside the near ground's edge, meters: the two overlap there, the near one in front. */
const OVERLAP_METERS = 16;
/** The ground's colour is kept on a grid this coarse, meters (it changes over hundreds of meters). */
const TINT_CELL_METERS = 32;
/** Light on a slope: its share from a fixed sun high in the south-west, the rest from the sky above. */
const SUN = { x: -0.35, y: 0.8, z: -0.48 };
const SUN_SHARE = 0.32;

/** Where the near ground is: its middle and half its size, for the far ground's material to leave that square out. */
export type GroundWindow = { value: Vector4 };

/**
 * The ground of a map with hills (TrackView, for a terrain that is not
 * flat): the whole map coarse (FAR_GROUND_CELL_METERS), and round the
 * camera a square of it fine (NEAR_GROUND_CELL_METERS, on the terrain's own
 * vertices), which moves on with the camera a few cells at a time (update):
 * two draw calls in all. The far ground leaves out the near square (its
 * material reads `window`) but for a band where both are drawn, the far one
 * pushed back, so no crack shows between them. Slopes facing the sun are
 * lit more than those facing away, baked into the vertex colours with the
 * ground's tint (`tint`): the ground's material is pre-lit. Its uvs are the
 * flat ground's (0.5 + x / size, 0.5 − z / size).
 */
export class TerrainGround {
  readonly far: Mesh;
  readonly near: Mesh;
  readonly window: GroundWindow = { value: new Vector4(0, 0, -1, 0) };
  private readonly tints: Float32Array;
  private readonly tintColumns: number;
  private readonly tintOrigin: number;
  private centreX = Number.NaN;
  private centreZ = Number.NaN;
  private readonly side = NEAR_GROUND_METERS / NEAR_GROUND_CELL_METERS + 1;

  constructor(
    private readonly terrain: Terrain,
    private readonly sizeMeters: number,
    tint: (x: number, z: number, out: Color) => Color,
    farMaterial: Material,
    nearMaterial: Material,
  ) {
    // The ground's tint on a coarse grid, read back between its points.
    const half = sizeMeters / 2;
    this.tintOrigin = -half;
    this.tintColumns = Math.ceil(sizeMeters / TINT_CELL_METERS) + 1;
    this.tints = new Float32Array(this.tintColumns * this.tintColumns * 3);
    const color = new Color();
    for (let j = 0; j < this.tintColumns; j++) {
      for (let i = 0; i < this.tintColumns; i++) {
        tint(this.tintOrigin + i * TINT_CELL_METERS, this.tintOrigin + j * TINT_CELL_METERS, color);
        this.tints.set([color.r, color.g, color.b], (j * this.tintColumns + i) * 3);
      }
    }
    const farSide = Math.ceil(sizeMeters / FAR_GROUND_CELL_METERS) + 1;
    const far = gridGeometry(farSide);
    this.fill(far, -half, -half, (sizeMeters / (farSide - 1)));
    this.far = new Mesh(far, farMaterial);
    this.far.name = 'ground:far';
    const near = gridGeometry(this.side);
    this.near = new Mesh(near, nearMaterial);
    this.near.name = 'ground:near';
    // Its vertices move with the camera: bounds worked out once would go stale.
    this.near.frustumCulled = false;
  }

  /** Moves the near ground on to the camera at (x, z) when it has gone far enough. Cheap unless it moves. */
  update(x: number, z: number): void {
    if (Math.abs(x - this.centreX) < RECENTRE_METERS && Math.abs(z - this.centreZ) < RECENTRE_METERS) {
      return;
    }
    // On the terrain's own vertices: a whole number of cells from the map's middle.
    this.centreX = Math.round(x / NEAR_GROUND_CELL_METERS) * NEAR_GROUND_CELL_METERS;
    this.centreZ = Math.round(z / NEAR_GROUND_CELL_METERS) * NEAR_GROUND_CELL_METERS;
    const half = NEAR_GROUND_METERS / 2;
    this.fill(this.near.geometry, this.centreX - half, this.centreZ - half, NEAR_GROUND_CELL_METERS);
    this.window.value.set(this.centreX, this.centreZ, half - OVERLAP_METERS, 0);
  }

  dispose(): void {
    this.far.geometry.dispose();
    this.near.geometry.dispose();
  }

  /** Sets a grid's vertices on the terrain from (x0, z0), `cell` apart: heights, uvs, tints lit by their slope. */
  private fill(geometry: BufferGeometry, x0: number, z0: number, cell: number): void {
    const positions = geometry.getAttribute('position') as BufferAttribute;
    const colors = geometry.getAttribute('color') as BufferAttribute;
    const uvs = geometry.getAttribute('uv') as BufferAttribute;
    const side = Math.round(Math.sqrt(positions.count));
    const terrain = this.terrain;
    const size = this.sizeMeters;
    const p = positions.array as Float32Array;
    const c = colors.array as Float32Array;
    const u = uvs.array as Float32Array;
    const step = Math.min(cell, NEAR_GROUND_CELL_METERS);
    for (let j = 0; j < side; j++) {
      const z = z0 + j * cell;
      for (let i = 0; i < side; i++) {
        const x = x0 + i * cell;
        const v = j * side + i;
        const height = terrain.heightAt(x, z);
        p[v * 3] = x;
        p[v * 3 + 1] = height;
        p[v * 3 + 2] = z;
        u[v * 2] = 0.5 + x / size;
        u[v * 2 + 1] = 0.5 - z / size;
        // The slope's normal from the heights either side, lit by the fixed sun and the sky.
        const nx = terrain.heightAt(x - step, z) - terrain.heightAt(x + step, z);
        const nz = terrain.heightAt(x, z - step) - terrain.heightAt(x, z + step);
        const ny = 2 * step;
        const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const facing = (nx * SUN.x + ny * SUN.y + nz * SUN.z) / length;
        const flat = SUN.y;
        const light = 1 + SUN_SHARE * (facing - flat);
        this.tintAt(x, z, c, v * 3, light);
      }
    }
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    uvs.needsUpdate = true;
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
  }

  /** The tint at (x, z) times `light`, into `out` at `at`. */
  private tintAt(x: number, z: number, out: Float32Array, at: number, light: number): void {
    const columns = this.tintColumns;
    const u = Math.min(columns - 1.001, Math.max(0, (x - this.tintOrigin) / TINT_CELL_METERS));
    const v = Math.min(columns - 1.001, Math.max(0, (z - this.tintOrigin) / TINT_CELL_METERS));
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const a = (j * columns + i) * 3;
    const b = a + 3;
    const c = a + columns * 3;
    const d = c + 3;
    const tints = this.tints;
    for (let k = 0; k < 3; k++) {
      const near = tints[a + k]! + (tints[b + k]! - tints[a + k]!) * fu;
      const far = tints[c + k]! + (tints[d + k]! - tints[c + k]!) * fu;
      out[at + k] = (near + (far - near) * fv) * light;
    }
  }
}

/** A square grid of `side` × `side` vertices (positions, colours, uvs to be filled), its faces up. */
function gridGeometry(side: number): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(side * side * 3), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(side * side * 3), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(side * side * 2), 2));
  const count = (side - 1) * (side - 1) * 6;
  const indices = side * side <= 65536 ? new Uint16Array(count) : new Uint32Array(count);
  let k = 0;
  for (let j = 0; j + 1 < side; j++) {
    for (let i = 0; i + 1 < side; i++) {
      const a = j * side + i;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      // Rows run toward +z, columns toward +x: wound so the faces look up.
      indices.set([a, c, b, b, c, d], k);
      k += 6;
    }
  }
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}
