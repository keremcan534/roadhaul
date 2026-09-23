import { cellKey, cellOf } from './gridCells';
import type { RoadPath } from './RoadPath';

/**
 * The roads' centreline pieces filed by grid cell, so what lies on or near a
 * road is found from the few pieces around a point instead of every piece
 * of every road (about 2,900 in the north_valley region). The truck asks
 * which ground it is on every fixed step. Built once per world.
 */
export class RoadGrid {
  /** Per cell: pairs of road index and piece index. */
  private readonly cells = new Map<number, Int32Array>();

  /**
   * Files every piece in each cell it passes within `reachMeters` of the
   * road's edge: the farthest from a road that nearRoad() can look.
   */
  constructor(
    private readonly roads: readonly RoadPath[],
    private readonly reachMeters: number,
  ) {
    const building = new Map<number, number[]>();
    roads.forEach((road, roadIndex) => {
      const reach = road.widthMeters / 2 + reachMeters;
      for (let segment = 0; segment < road.segmentCount; segment++) {
        const next = (segment + 1) % road.pointCount;
        const minCellX = cellOf(Math.min(road.x(segment), road.x(next)) - reach);
        const maxCellX = cellOf(Math.max(road.x(segment), road.x(next)) + reach);
        const minCellZ = cellOf(Math.min(road.z(segment), road.z(next)) - reach);
        const maxCellZ = cellOf(Math.max(road.z(segment), road.z(next)) + reach);
        for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
          for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
            const key = cellKey(cellX, cellZ);
            const pieces = building.get(key);
            if (pieces === undefined) {
              building.set(key, [roadIndex, segment]);
            } else {
              pieces.push(roadIndex, segment);
            }
          }
        }
      }
    });
    for (const [key, pieces] of building) {
      this.cells.set(key, Int32Array.from(pieces));
    }
  }

  /** True when (x, z) is on a road's paved surface: at most half its width from the centreline. Allocation-free. */
  onRoad(x: number, z: number): boolean {
    const pieces = this.cells.get(cellKey(cellOf(x), cellOf(z)));
    if (pieces === undefined) {
      return false;
    }
    for (let k = 0; k < pieces.length; k += 2) {
      const road = this.roads[pieces[k]!]!;
      if (road.segmentDistance(pieces[k + 1]!, x, z) <= road.widthMeters / 2) {
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
    const pieces = this.cells.get(cellKey(cellOf(x), cellOf(z)));
    if (pieces === undefined) {
      return false;
    }
    for (let k = 0; k < pieces.length; k += 2) {
      const road = this.roads[pieces[k]!]!;
      if (road.segmentDistance(pieces[k + 1]!, x, z) < road.widthMeters / 2 + clearanceMeters) {
        return true;
      }
    }
    return false;
  }
}
