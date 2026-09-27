import { cellOf } from './gridCells';
import type { RoadPath } from './RoadPath';

/**
 * The roads' centreline pieces filed by grid cell, so what lies on or near a
 * road is found from the few pieces around a point instead of every piece
 * of every road (about 2,900 in the north_valley region). The truck asks
 * which ground it is on every fixed step. Built once per world.
 */
export class RoadGrid {
  /** The first cell (cellOf) the roads reach along x and along z, and how many they span each way. */
  private readonly firstColumn: number;
  private readonly firstRow: number;
  private readonly columns: number;
  private readonly rows: number;
  /**
   * Cell c's pieces (c = column * rows + row, counted from the first) are
   * pairs of road index and piece index in `pieces`, from pair `starts[c]`
   * up to (not including) pair `starts[c + 1]`: flat arrays, so a look
   * needs no hashing and building the grid makes no garbage.
   */
  private readonly starts: Int32Array;
  private readonly pieces: Int32Array;

  /**
   * Files every piece in each cell it passes within `reachMeters` of the
   * road's edge: the farthest from a road that nearRoad() can look.
   */
  constructor(
    private readonly roads: readonly RoadPath[],
    private readonly reachMeters: number,
  ) {
    let firstColumn = Infinity;
    let lastColumn = -Infinity;
    let firstRow = Infinity;
    let lastRow = -Infinity;
    for (const road of roads) {
      const reach = road.widthMeters / 2 + reachMeters;
      for (let i = 0; i < road.pointCount; i++) {
        firstColumn = Math.min(firstColumn, cellOf(road.x(i) - reach));
        lastColumn = Math.max(lastColumn, cellOf(road.x(i) + reach));
        firstRow = Math.min(firstRow, cellOf(road.z(i) - reach));
        lastRow = Math.max(lastRow, cellOf(road.z(i) + reach));
      }
    }
    const empty = firstColumn > lastColumn;
    this.firstColumn = empty ? 0 : firstColumn;
    this.firstRow = empty ? 0 : firstRow;
    this.columns = empty ? 0 : lastColumn - firstColumn + 1;
    this.rows = empty ? 0 : lastRow - firstRow + 1;
    // Count each cell's pieces, then file them, in the same order: road by road, piece by piece.
    const starts = new Int32Array(this.columns * this.rows + 1);
    this.forEachFiling((cell) => {
      starts[cell + 1]!++;
    });
    for (let cell = 0; cell < this.columns * this.rows; cell++) {
      starts[cell + 1]! += starts[cell]!;
    }
    const pieces = new Int32Array(starts[this.columns * this.rows]! * 2);
    const filled = starts.slice(0, this.columns * this.rows);
    this.forEachFiling((cell, roadIndex, segment) => {
      const at = filled[cell]!++;
      pieces[at * 2] = roadIndex;
      pieces[at * 2 + 1] = segment;
    });
    this.starts = starts;
    this.pieces = pieces;
  }

  /** Calls `file` with every cell each piece of each road is filed in, road by road, piece by piece. */
  private forEachFiling(file: (cell: number, roadIndex: number, segment: number) => void): void {
    this.roads.forEach((road, roadIndex) => {
      const reach = road.widthMeters / 2 + this.reachMeters;
      for (let segment = 0; segment < road.segmentCount; segment++) {
        const next = (segment + 1) % road.pointCount;
        const minColumn = cellOf(Math.min(road.x(segment), road.x(next)) - reach) - this.firstColumn;
        const maxColumn = cellOf(Math.max(road.x(segment), road.x(next)) + reach) - this.firstColumn;
        const minRow = cellOf(Math.min(road.z(segment), road.z(next)) - reach) - this.firstRow;
        const maxRow = cellOf(Math.max(road.z(segment), road.z(next)) + reach) - this.firstRow;
        for (let column = minColumn; column <= maxColumn; column++) {
          for (let row = minRow; row <= maxRow; row++) {
            file(column * this.rows + row, roadIndex, segment);
          }
        }
      }
    });
  }

  /** The cell holding (x, z), or -1 where no road reaches. */
  private cellAt(x: number, z: number): number {
    const column = cellOf(x) - this.firstColumn;
    const row = cellOf(z) - this.firstRow;
    return column >= 0 && column < this.columns && row >= 0 && row < this.rows ? column * this.rows + row : -1;
  }

  /** True when (x, z) is on a road's paved surface: at most half its width from the centreline. Allocation-free. */
  onRoad(x: number, z: number): boolean {
    const cell = this.cellAt(x, z);
    if (cell < 0) {
      return false;
    }
    const pieces = this.pieces;
    for (let k = this.starts[cell]!, end = this.starts[cell + 1]!; k < end; k++) {
      const road = this.roads[pieces[k * 2]!]!;
      if (road.segmentDistance(pieces[k * 2 + 1]!, x, z) <= road.widthMeters / 2) {
        return true;
      }
    }
    return false;
  }

  /** True when (x, z) is closer than `clearanceMeters` (at most the grid's reach) to a road's edge. Allocation-free. */
  nearRoad(x: number, z: number, clearanceMeters: number): boolean {
    if (clearanceMeters > this.reachMeters) {
      throw new Error(`The road grid looks ${this.reachMeters} m from the roads, not ${clearanceMeters} m.`);
    }
    const cell = this.cellAt(x, z);
    if (cell < 0) {
      return false;
    }
    const pieces = this.pieces;
    for (let k = this.starts[cell]!, end = this.starts[cell + 1]!; k < end; k++) {
      const road = this.roads[pieces[k * 2]!]!;
      if (road.segmentDistance(pieces[k * 2 + 1]!, x, z) < road.widthMeters / 2 + clearanceMeters) {
        return true;
      }
    }
    return false;
  }
}
