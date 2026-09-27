import type { Point2 } from '../../data/definitions/MapDefinition';

/**
 * Ways across open land for new roads (the villages' roads and the side
 * roads that join two roads): the shortest over a grid of cells round
 * whatever is in the way, then pulled straight wherever a straight run is
 * clear, as a line of points from one end to the other.
 */

/** What a new road may cross, as the routing asks it. */
export interface RouteLand {
  readonly halfSizeMeters: number;
  /**
   * Whether the land at (x, z) is open to a road: the same answer every
   * time it is asked (the grid keeps it).
   */
  isLandOpen(x: number, z: number): boolean;
}

/** The grid's cells are this big, meters. */
const CELL_METERS = 32;
/**
 * A route gives up after looking at this many cells, and this many more
 * per square of its ends' distance apart in cells: a way far round is not
 * worth the look.
 */
const MIN_EXPANDED_CELLS = 2000;
const EXPANDED_CELLS_PER_SQUARE = 4;
const MAX_EXPANDED_CELLS = 40000;
/** The search leans toward the goal by this much: a way a little longer than the shortest, found far sooner. */
const GREED = 1.25;
/** Straight runs are looked along every this many meters, and this far either side of their line. */
const RUN_SPACING_METERS = 5;
/** Pulled straight, a route's corners keep at most this far apart: the road's curve follows its control points. */
const MAX_LEG_METERS = 110;

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/**
 * Routes across `land`, remembering which cells are open. Reuse one for
 * every route over the same land.
 */
export class LandRouter {
  private readonly size: number;
  /** Per cell: 0 not asked yet, 1 open land, 2 not. */
  private readonly landOpen: Uint8Array;
  private readonly cost: Float64Array;
  private readonly from: Int32Array;
  /** The route each cell's cost and way back belong to. */
  private readonly stamp: Int32Array;
  private readonly closed: Int32Array;
  /** Per cell: the route that asked whether it is clear, and the answer (1 clear, 2 not). */
  private readonly clearStamp: Int32Array;
  private readonly clear: Uint8Array;
  private routes = 0;
  /** The open cells to look at, a binary heap by estimated total cost, `heapSize` of them. */
  private heap: Int32Array;
  private heapCost: Float64Array;
  private heapSize = 0;

  constructor(private readonly land: RouteLand) {
    this.size = Math.ceil((land.halfSizeMeters * 2) / CELL_METERS);
    const cells = this.size * this.size;
    this.landOpen = new Uint8Array(cells);
    this.cost = new Float64Array(cells);
    this.from = new Int32Array(cells);
    this.stamp = new Int32Array(cells);
    this.closed = new Int32Array(cells);
    this.clearStamp = new Int32Array(cells);
    this.clear = new Uint8Array(cells);
    this.heap = new Int32Array(1024);
    this.heapCost = new Float64Array(1024);
  }

  /**
   * The way from (fromX, fromZ) to (toX, toZ) over open land where
   * `isClearOnLand` lets a road pass (asked only where the land is open):
   * its points, both ends exactly, at most MAX_LEG_METERS apart. Null where
   * there is none. The cells that hold the ends are taken as open.
   */
  route(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    isClearOnLand: (x: number, z: number) => boolean,
  ): Point2[] | null {
    const start = this.cellAt(fromX, fromZ);
    const goal = this.cellAt(toX, toZ);
    if (start < 0 || goal < 0) {
      return null;
    }
    const cells = this.search(start, goal, isClearOnLand);
    if (cells === null) {
      return null;
    }
    const line: Point2[] = [[fromX, fromZ], ...cells.slice(1, -1).map((cell) => this.middleOf(cell)), [toX, toZ]];
    return spaceOut(pullStraight(line, (x, z) => this.land.isLandOpen(x, z) && isClearOnLand(x, z)));
  }

  /** A* over the cells from `start` to `goal`, through cells whose middle is open land and clear. The cells on the way, or null. */
  private search(start: number, goal: number, isClear: (x: number, z: number) => boolean): number[] | null {
    const route = ++this.routes;
    const size = this.size;
    const goalColumn = goal % size;
    const goalRow = Math.floor(goal / size);
    const estimate = (cell: number): number =>
      Math.hypot((cell % size) - goalColumn, Math.floor(cell / size) - goalRow) * CELL_METERS * GREED;
    const apart = Math.hypot((start % size) - goalColumn, Math.floor(start / size) - goalRow);
    const most = Math.min(MAX_EXPANDED_CELLS, MIN_EXPANDED_CELLS + EXPANDED_CELLS_PER_SQUARE * apart * apart);
    this.heapSize = 0;
    this.stamp[start] = route;
    this.cost[start] = 0;
    this.from[start] = -1;
    this.push(start, estimate(start));
    let expanded = 0;
    while (this.heapSize > 0) {
      const cell = this.pop();
      if (cell === goal) {
        const cells: number[] = [];
        for (let at = goal; at >= 0; at = this.from[at]!) {
          cells.push(at);
        }
        return cells.reverse();
      }
      if (this.closed[cell] === route) {
        continue;
      }
      this.closed[cell] = route;
      if (++expanded > most) {
        return null;
      }
      const column = cell % size;
      const row = Math.floor(cell / size);
      for (const [dx, dz] of NEIGHBOURS) {
        const nextColumn = column + dx;
        const nextRow = row + dz;
        if (nextColumn < 0 || nextRow < 0 || nextColumn >= size || nextRow >= size) {
          continue;
        }
        const next = nextRow * size + nextColumn;
        if (this.closed[next] === route) {
          continue;
        }
        const nextCost = this.cost[cell]! + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1) * CELL_METERS;
        if (this.stamp[next] === route && this.cost[next]! <= nextCost) {
          continue;
        }
        if (next !== goal && !this.isOpenCell(next, isClear)) {
          continue;
        }
        this.stamp[next] = route;
        this.cost[next] = nextCost;
        this.from[next] = cell;
        this.push(next, nextCost + estimate(next));
      }
    }
    return null;
  }

  private isOpenCell(cell: number, isClear: (x: number, z: number) => boolean): boolean {
    const half = this.land.halfSizeMeters;
    const x = ((cell % this.size) + 0.5) * CELL_METERS - half;
    const z = (Math.floor(cell / this.size) + 0.5) * CELL_METERS - half;
    let open = this.landOpen[cell]!;
    if (open === 0) {
      open = this.land.isLandOpen(x, z) ? 1 : 2;
      this.landOpen[cell] = open;
    }
    if (open !== 1) {
      return false;
    }
    // Asked once per route: nothing grows while a way is found.
    if (this.clearStamp[cell] !== this.routes) {
      this.clearStamp[cell] = this.routes;
      this.clear[cell] = isClear(x, z) ? 1 : 2;
    }
    return this.clear[cell] === 1;
  }

  private cellAt(x: number, z: number): number {
    const column = Math.floor((x + this.land.halfSizeMeters) / CELL_METERS);
    const row = Math.floor((z + this.land.halfSizeMeters) / CELL_METERS);
    return column < 0 || row < 0 || column >= this.size || row >= this.size ? -1 : row * this.size + column;
  }

  private middleOf(cell: number): Point2 {
    const half = this.land.halfSizeMeters;
    return [((cell % this.size) + 0.5) * CELL_METERS - half, (Math.floor(cell / this.size) + 0.5) * CELL_METERS - half];
  }

  private push(cell: number, cost: number): void {
    if (this.heapSize === this.heap.length) {
      const heap = new Int32Array(this.heap.length * 2);
      heap.set(this.heap);
      this.heap = heap;
      const costs = new Float64Array(this.heapCost.length * 2);
      costs.set(this.heapCost);
      this.heapCost = costs;
    }
    const heap = this.heap;
    const costs = this.heapCost;
    let i = this.heapSize++;
    // Sift up: move parents down until the new cell's place is found.
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (costs[parent]! <= cost) {
        break;
      }
      heap[i] = heap[parent]!;
      costs[i] = costs[parent]!;
      i = parent;
    }
    heap[i] = cell;
    costs[i] = cost;
  }

  private pop(): number {
    const heap = this.heap;
    const costs = this.heapCost;
    const top = heap[0]!;
    const size = --this.heapSize;
    if (size > 0) {
      const lastCell = heap[size]!;
      const lastCost = costs[size]!;
      // Sift down: move the smaller child up until the last cell's place is found.
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        if (left >= size) {
          break;
        }
        const child = left + 1 < size && costs[left + 1]! < costs[left]! ? left + 1 : left;
        if (costs[child]! >= lastCost) {
          break;
        }
        heap[i] = heap[child]!;
        costs[i] = costs[child]!;
        i = child;
      }
      heap[i] = lastCell;
      costs[i] = lastCost;
    }
    return top;
  }
}

/** Whether the straight run from a to b is clear all along. */
export function isClearRun(ax: number, az: number, bx: number, bz: number, isClear: (x: number, z: number) => boolean): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / RUN_SPACING_METERS));
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    if (!isClear(ax + (bx - ax) * t, az + (bz - az) * t)) {
      return false;
    }
  }
  return true;
}

/**
 * The line's points where it turns, the ones between skipped wherever the
 * straight run past them is clear: from each point kept, as far along as a
 * clear run reaches, found by doubling the reach and then halving back.
 */
function pullStraight(line: readonly Point2[], isClear: (x: number, z: number) => boolean): Point2[] {
  const pulled: Point2[] = [line[0]!];
  const last = line.length - 1;
  let at = 0;
  while (at < last) {
    const [ax, az] = line[at]!;
    const clearTo = (index: number): boolean => isClearRun(ax, az, line[index]![0], line[index]![1], isClear);
    // The next point is always reachable: the cells between neighbours are open.
    let reach = at + 1;
    let step = 1;
    let blocked = last + 1;
    while (reach + step <= last && reach + step < blocked) {
      if (clearTo(reach + step)) {
        reach += step;
        step *= 2;
      } else {
        blocked = reach + step;
        step = Math.max(1, step >> 1);
        if (step === 1 && !clearTo(reach + 1)) {
          break;
        }
      }
    }
    pulled.push(line[reach]!);
    at = reach;
  }
  return pulled;
}

/** The line with points added along its longer legs, so no two are more than `maxLegMeters` apart. */
export function spaceOut(line: readonly Point2[], maxLegMeters = MAX_LEG_METERS): Point2[] {
  const spaced: Point2[] = [line[0]!];
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1]!;
    const [bx, bz] = line[i]!;
    const pieces = Math.ceil(Math.hypot(bx - ax, bz - az) / maxLegMeters);
    for (let piece = 1; piece < pieces; piece++) {
      spaced.push([ax + ((bx - ax) * piece) / pieces, az + ((bz - az) * piece) / pieces]);
    }
    // The leg's end exactly as it was: a route ends on a road's sample.
    spaced.push(line[i]!);
  }
  return spaced;
}
