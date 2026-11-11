/**
 * The ground's height over a map, meters above the flat ground of the
 * towns (y = 0). Most maps are flat (FLAT_TERRAIN): asking costs nothing.
 * A map with hills keeps its heights in a grid (TerrainGrid), sampled
 * bilinearly, so the truck, the traffic and the ground's vertices ask it
 * cheaply; the roads are graded into it (terrainGrading.ts).
 */
export interface Terrain {
  /** True when the ground is at 0 everywhere. */
  readonly flat: boolean;
  /** The ground's height at (x, z), meters. Allocation-free. */
  heightAt(x: number, z: number): number;
}

export const FLAT_TERRAIN: Terrain = Object.freeze({
  flat: true,
  heightAt: (): number => 0,
});

/**
 * Heights on a square grid over the map: `columns` × `columns` vertices
 * `cellMeters` apart, from (−halfSize, −halfSize); beyond its edge the
 * edge's height. Bilinear between the vertices.
 */
export class TerrainGrid implements Terrain {
  readonly flat = false;
  readonly columns: number;
  readonly heights: Float32Array;
  private readonly origin: number;

  constructor(
    readonly halfSizeMeters: number,
    readonly cellMeters: number,
    height: (x: number, z: number) => number = () => 0,
  ) {
    if (!(cellMeters > 0) || !(halfSizeMeters > 0)) {
      throw new RangeError('A terrain grid needs a positive size and cell.');
    }
    this.columns = Math.ceil((2 * halfSizeMeters) / cellMeters) + 1;
    this.origin = -halfSizeMeters;
    this.heights = new Float32Array(this.columns * this.columns);
    for (let j = 0; j < this.columns; j++) {
      for (let i = 0; i < this.columns; i++) {
        this.heights[j * this.columns + i] = height(this.vertexX(i), this.vertexZ(j));
      }
    }
  }

  /** The x of vertex column `i`, and the z of vertex row `j`. */
  vertexX(i: number): number {
    return this.origin + i * this.cellMeters;
  }

  vertexZ(j: number): number {
    return this.origin + j * this.cellMeters;
  }

  /** The column (or row) of the cell (x or z) lies in, clamped to the grid. */
  cellOf(coordinate: number): number {
    return Math.min(this.columns - 2, Math.max(0, Math.floor((coordinate - this.origin) / this.cellMeters)));
  }

  heightAt(x: number, z: number): number {
    const columns = this.columns;
    const u = Math.min(columns - 1, Math.max(0, (x - this.origin) / this.cellMeters));
    const v = Math.min(columns - 1, Math.max(0, (z - this.origin) / this.cellMeters));
    const i = Math.min(columns - 2, Math.floor(u));
    const j = Math.min(columns - 2, Math.floor(v));
    const fu = u - i;
    const fv = v - j;
    const at = j * columns + i;
    const heights = this.heights;
    const near = heights[at]! + (heights[at + 1]! - heights[at]!) * fu;
    const far = heights[at + columns]! + (heights[at + columns + 1]! - heights[at + columns]!) * fu;
    return near + (far - near) * fv;
  }
}

/**
 * The ground's rise per meter along `heading` (radians, 0 along +z) at
 * (x, z): positive uphill. From the heights `reach` meters either side.
 * Allocation-free.
 */
export function gradeAt(terrain: Terrain, x: number, z: number, heading: number, reach = 2): number {
  if (terrain.flat) {
    return 0;
  }
  const dx = Math.sin(heading) * reach;
  const dz = Math.cos(heading) * reach;
  return (terrain.heightAt(x + dx, z + dz) - terrain.heightAt(x - dx, z - dz)) / (2 * reach);
}
