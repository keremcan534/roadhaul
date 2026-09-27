import { cellKey } from './gridCells';

const NONE: readonly number[] = Object.freeze([]);

/**
 * Things filed by the square cells their bounds cover, so what is near a
 * point is found among the few filed in its cell instead of all of them.
 * File each thing's bounds grown by the furthest any question looks from
 * it.
 */
export class Buckets {
  private readonly cells = new Map<number, number[]>();

  constructor(private readonly cellMeters: number) {}

  /** Files thing `id` in every cell its bounds cover. */
  add(id: number, minX: number, maxX: number, minZ: number, maxZ: number): void {
    const size = this.cellMeters;
    for (let column = Math.floor(minX / size); column <= Math.floor(maxX / size); column++) {
      for (let row = Math.floor(minZ / size); row <= Math.floor(maxZ / size); row++) {
        const key = cellKey(column, row);
        const bucket = this.cells.get(key);
        if (bucket === undefined) {
          this.cells.set(key, [id]);
        } else {
          bucket.push(id);
        }
      }
    }
  }

  /** The things filed in the cell holding (x, z). */
  at(x: number, z: number): readonly number[] {
    return this.cells.get(cellKey(Math.floor(x / this.cellMeters), Math.floor(z / this.cellMeters))) ?? NONE;
  }
}
