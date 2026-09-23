import type { RoadPath } from './RoadPath';
import { ROUTE_LOOK_AHEAD_METERS, type RouteGuidance } from './roadRoute';

/**
 * Samples of two different roads this close together join the roads. Roads
 * meet where they share a control point (the curve passes through its
 * control points, and every control point is a sample), so a junction is
 * exact, and roads that merely pass near each other stay apart.
 */
export const JUNCTION_RADIUS_METERS = 0.5;

/** Shortest distances by road to one target, and the way there. */
interface RouteField {
  /** From each node to the target, meters; Infinity where no road leads there. */
  readonly distance: Float64Array;
  /** The next node toward the target; -1 at the target and where no road leads there. */
  readonly next: Int32Array;
}

/**
 * The roads of a map joined into one graph (roadmap step 21; the navigation
 * of step 23 builds on it). Every centreline sample is a node, linked to its
 * neighbours along the road and, at junctions, to the other road's sample.
 *
 * Routes are computed once per target (a depot's bay), as the distance from
 * every node to it, and cached. Following one from wherever the truck is then
 * allocates nothing, so guide() can run every frame.
 */
export class RoadNetwork {
  readonly nodeCount: number;
  private readonly nodeX: Float64Array;
  private readonly nodeZ: Float64Array;
  /** Which road each node belongs to. */
  private readonly roadOf: Int32Array;
  /** Neighbours of node i: neighbours[firstNeighbour[i]] up to (not including) neighbours[firstNeighbour[i + 1]]. */
  private readonly firstNeighbour: Int32Array;
  private readonly neighbours: Int32Array;
  private readonly edgeLengths: Float64Array;
  private readonly fields = new Map<number, RouteField>();
  /** Where two roads meet (one entry per junction). */
  readonly junctions: readonly { readonly x: number; readonly z: number }[];

  constructor(roads: readonly RoadPath[]) {
    const count = roads.reduce((sum, road) => sum + road.pointCount, 0);
    this.nodeCount = count;
    this.nodeX = new Float64Array(count);
    this.nodeZ = new Float64Array(count);
    this.roadOf = new Int32Array(count);
    const links: number[][] = Array.from({ length: count }, () => []);
    const link = (a: number, b: number): void => {
      if (a !== b && !links[a]!.includes(b)) {
        links[a]!.push(b);
        links[b]!.push(a);
      }
    };

    let base = 0;
    roads.forEach((road, roadIndex) => {
      for (let i = 0; i < road.pointCount; i++) {
        this.nodeX[base + i] = road.x(i);
        this.nodeZ[base + i] = road.z(i);
        this.roadOf[base + i] = roadIndex;
      }
      for (let i = 0; i < road.segmentCount; i++) {
        link(base + i, base + ((i + 1) % road.pointCount));
      }
      base += road.pointCount;
    });
    const junctions: { x: number; z: number }[] = [];
    this.linkJunctions((a, b) => {
      link(a, b);
      const x = (this.nodeX[a]! + this.nodeX[b]!) / 2;
      const z = (this.nodeZ[a]! + this.nodeZ[b]!) / 2;
      if (!junctions.some((junction) => Math.hypot(junction.x - x, junction.z - z) < 1)) {
        junctions.push({ x, z });
      }
    });
    this.junctions = junctions;

    this.firstNeighbour = new Int32Array(count + 1);
    let edgeCount = 0;
    for (let i = 0; i < count; i++) {
      this.firstNeighbour[i] = edgeCount;
      edgeCount += links[i]!.length;
    }
    this.firstNeighbour[count] = edgeCount;
    this.neighbours = new Int32Array(edgeCount);
    this.edgeLengths = new Float64Array(edgeCount);
    for (let i = 0; i < count; i++) {
      links[i]!.forEach((j, k) => {
        const edge = this.firstNeighbour[i]! + k;
        this.neighbours[edge] = j;
        this.edgeLengths[edge] = Math.hypot(this.nodeX[j]! - this.nodeX[i]!, this.nodeZ[j]! - this.nodeZ[i]!);
      });
    }
  }

  /** How many separate networks the roads form: 1 when every road can be reached from every other. */
  get componentCount(): number {
    const seen = new Uint8Array(this.nodeCount);
    let components = 0;
    const stack: number[] = [];
    for (let start = 0; start < this.nodeCount; start++) {
      if (seen[start] === 1) {
        continue;
      }
      components++;
      seen[start] = 1;
      stack.push(start);
      while (stack.length > 0) {
        const node = stack.pop()!;
        for (let edge = this.firstNeighbour[node]!; edge < this.firstNeighbour[node + 1]!; edge++) {
          const next = this.neighbours[edge]!;
          if (seen[next] === 0) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
    }
    return components;
  }

  /** The node closest to (x, z). Allocation-free. -1 without roads. */
  nearestNode(x: number, z: number): number {
    let best = -1;
    let bestDistanceSquared = Infinity;
    for (let i = 0; i < this.nodeCount; i++) {
      const dx = this.nodeX[i]! - x;
      const dz = this.nodeZ[i]! - z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared;
        best = i;
      }
    }
    return best;
  }

  /**
   * Guidance from (fromX, fromZ) to (toX, toZ), written into `out`: both ends
   * snap to their nearest road, and the route follows the roads the shortest
   * way. Close to the target by road, or where no road connects the two, it
   * points straight at the target. Allocation-free once the target's route
   * has been computed (the first call for a target computes it).
   */
  guide(fromX: number, fromZ: number, toX: number, toZ: number, out: RouteGuidance): RouteGuidance {
    out.distanceMeters = Math.hypot(toX - fromX, toZ - fromZ);
    out.aimX = toX;
    out.aimZ = toZ;
    const target = this.nearestNode(toX, toZ);
    if (target < 0) {
      return out;
    }
    const start = this.nearestNode(fromX, fromZ);
    const field = this.routeTo(target);
    const along = field.distance[start]!;
    if (!(along < Infinity) || along < ROUTE_LOOK_AHEAD_METERS) {
      return out; // No road connects them, or nearly there: head straight for it.
    }
    const onRoad = Math.hypot(this.nodeX[start]! - fromX, this.nodeZ[start]! - fromZ);
    const offRoad = Math.hypot(toX - this.nodeX[target]!, toZ - this.nodeZ[target]!);
    out.distanceMeters = along + onRoad + offRoad;
    let aim = start;
    while (aim !== target && along - field.distance[aim]! < ROUTE_LOOK_AHEAD_METERS) {
      aim = field.next[aim]!;
    }
    out.aimX = this.nodeX[aim]!;
    out.aimZ = this.nodeZ[aim]!;
    return out;
  }

  /** Joins samples of different roads that share a position (see JUNCTION_RADIUS_METERS). */
  private linkJunctions(link: (a: number, b: number) => void): void {
    const cellOf = (value: number): number => Math.floor(value / JUNCTION_RADIUS_METERS);
    const cells = new Map<string, number[]>();
    for (let i = 0; i < this.nodeCount; i++) {
      const key = `${cellOf(this.nodeX[i]!)},${cellOf(this.nodeZ[i]!)}`;
      const cell = cells.get(key);
      if (cell === undefined) {
        cells.set(key, [i]);
      } else {
        cell.push(i);
      }
    }
    for (let i = 0; i < this.nodeCount; i++) {
      const cx = cellOf(this.nodeX[i]!);
      const cz = cellOf(this.nodeZ[i]!);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const j of cells.get(`${cx + dx},${cz + dz}`) ?? []) {
            const close =
              Math.hypot(this.nodeX[j]! - this.nodeX[i]!, this.nodeZ[j]! - this.nodeZ[i]!) <= JUNCTION_RADIUS_METERS;
            if (j > i && close && this.roadOf[j] !== this.roadOf[i]) {
              link(i, j);
            }
          }
        }
      }
    }
  }

  /** The cached route to `target`, computed on first use (Dijkstra from the target outward). */
  private routeTo(target: number): RouteField {
    const cached = this.fields.get(target);
    if (cached !== undefined) {
      return cached;
    }
    const distance = new Float64Array(this.nodeCount).fill(Infinity);
    const next = new Int32Array(this.nodeCount).fill(-1);
    const queue = new MinHeap(this.nodeCount);
    distance[target] = 0;
    queue.push(target, 0);
    while (queue.size > 0) {
      const node = queue.pop();
      for (let edge = this.firstNeighbour[node]!; edge < this.firstNeighbour[node + 1]!; edge++) {
        const neighbour = this.neighbours[edge]!;
        const viaNode = distance[node]! + this.edgeLengths[edge]!;
        if (viaNode < distance[neighbour]!) {
          distance[neighbour] = viaNode;
          next[neighbour] = node;
          queue.push(neighbour, viaNode);
        }
      }
    }
    const field = { distance, next };
    this.fields.set(target, field);
    return field;
  }
}

/** A binary min-heap of node ids by priority. Stale entries are skipped when popped (lazy deletion). */
class MinHeap {
  private nodes: Int32Array;
  private priorities: Float64Array;
  private count = 0;
  /** Best priority pushed per node, to recognise stale entries. */
  private readonly best: Float64Array;

  constructor(nodeCount: number) {
    this.nodes = new Int32Array(Math.max(16, nodeCount));
    this.priorities = new Float64Array(this.nodes.length);
    this.best = new Float64Array(nodeCount).fill(Infinity);
  }

  get size(): number {
    this.dropStale();
    return this.count;
  }

  push(node: number, priority: number): void {
    this.best[node] = priority;
    if (this.count === this.nodes.length) {
      this.grow();
    }
    let index = this.count++;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.priorities[parent]! <= priority) {
        break;
      }
      this.nodes[index] = this.nodes[parent]!;
      this.priorities[index] = this.priorities[parent]!;
      index = parent;
    }
    this.nodes[index] = node;
    this.priorities[index] = priority;
  }

  /** Removes and returns the node with the lowest priority. Call only when size > 0. */
  pop(): number {
    this.dropStale();
    return this.removeTop();
  }

  private dropStale(): void {
    while (this.count > 0 && this.priorities[0]! > this.best[this.nodes[0]!]!) {
      this.removeTop();
    }
  }

  private removeTop(): number {
    const top = this.nodes[0]!;
    const lastNode = this.nodes[--this.count]!;
    const lastPriority = this.priorities[this.count]!;
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      if (left >= this.count) {
        break;
      }
      const right = left + 1;
      const child = right < this.count && this.priorities[right]! < this.priorities[left]! ? right : left;
      if (this.priorities[child]! >= lastPriority) {
        break;
      }
      this.nodes[index] = this.nodes[child]!;
      this.priorities[index] = this.priorities[child]!;
      index = child;
    }
    this.nodes[index] = lastNode;
    this.priorities[index] = lastPriority;
    return top;
  }

  private grow(): void {
    const nodes = new Int32Array(this.nodes.length * 2);
    const priorities = new Float64Array(this.nodes.length * 2);
    nodes.set(this.nodes);
    priorities.set(this.priorities);
    this.nodes = nodes;
    this.priorities = priorities;
  }
}
