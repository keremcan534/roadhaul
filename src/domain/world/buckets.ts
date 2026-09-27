import { cellKey } from './gridCells';

const NONE: readonly number[] = Object.freeze([]);

/**
 * Things filed by the square cells their bounds cover, so what is near a
 * point is found among the few filed in its cell instead of all of them.
 * File each thing's bounds grown by the furthest any question looks from
 * it.
 */
export class Buckets {
  /** The cells beyond the grid below (all of them, without one). */
  private readonly cells = new Map<number, number[]>();
  /**
   * The cells over the map, square round the middle out to the half size
   * given: each one's bucket in `lists`, plus one (0: none), so a look needs
   * no hashing (growing a big map looks hundreds of thousands of times).
   */
  private readonly slots: Int32Array;
  private readonly lists: number[][] = [];
  /** The grid's first cell along either axis, and how many cells it spans. */
  private readonly first: number;
  private readonly span: number;

  /** `halfSizeMeters`: the map's, for the grid (0: none, every cell hashed). */
  constructor(
    private readonly cellMeters: number,
    halfSizeMeters = 0,
  ) {
    this.first = Math.floor(-halfSizeMeters / cellMeters);
    this.span = halfSizeMeters > 0 ? Math.floor(halfSizeMeters / cellMeters) - this.first + 1 : 0;
    this.slots = new Int32Array(this.span * this.span);
  }

  /** Files thing `id` in every cell its bounds cover. */
  add(id: number, minX: number, maxX: number, minZ: number, maxZ: number): void {
    const size = this.cellMeters;
    for (let column = Math.floor(minX / size); column <= Math.floor(maxX / size); column++) {
      for (let row = Math.floor(minZ / size); row <= Math.floor(maxZ / size); row++) {
        const slot = this.slotOf(column, row);
        if (slot < 0) {
          const key = cellKey(column, row);
          const bucket = this.cells.get(key);
          if (bucket === undefined) {
            this.cells.set(key, [id]);
          } else {
            bucket.push(id);
          }
        } else if (this.slots[slot] === 0) {
          this.lists.push([id]);
          this.slots[slot] = this.lists.length;
        } else {
          this.lists[this.slots[slot]! - 1]!.push(id);
        }
      }
    }
  }

  /** The things filed in the cell holding (x, z). */
  at(x: number, z: number): readonly number[] {
    const column = Math.floor(x / this.cellMeters);
    const row = Math.floor(z / this.cellMeters);
    const slot = this.slotOf(column, row);
    if (slot < 0) {
      return this.cells.get(cellKey(column, row)) ?? NONE;
    }
    const list = this.slots[slot]!;
    return list === 0 ? NONE : this.lists[list - 1]!;
  }

  /** Where the grid keeps cell (column, row), or -1 beyond it. */
  private slotOf(column: number, row: number): number {
    const c = column - this.first;
    const r = row - this.first;
    return c >= 0 && c < this.span && r >= 0 && r < this.span ? c * this.span + r : -1;
  }
}
