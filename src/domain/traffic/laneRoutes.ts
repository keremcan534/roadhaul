import type { LaneGraph } from './LaneGraph';

/**
 * The way through the lanes to a place (a depot, for a company truck in the
 * traffic). For every link: meters from its start to where the place is
 * reached, through the links after it (Infinity where no way leads there).
 * On the lanes that pass the place: how far along them it is reached (-1 on
 * every other link). TrafficSimulation's guests take, at each junction, the
 * way with the least left to go.
 */
export interface LaneRoute {
  readonly distances: Float64Array;
  readonly arriveAt: Float64Array;
}

/**
 * The route to (x, z). It is reached level with (x, z) on every lane that
 * passes within `reachMeters` of the nearest lane there: the road beside a
 * depot, either way. Dijkstra backwards over the links: it allocates, so
 * work it out once for each place on a map.
 */
export function laneRouteTo(graph: LaneGraph, x: number, z: number, reachMeters: number): LaneRoute {
  const count = graph.linkCount;
  const nearest = new Float64Array(count).fill(Infinity);
  const nearestAlong = new Float64Array(count);
  let closest = Infinity;
  for (let link = 0; link < count; link++) {
    if (graph.isTurn(link)) {
      continue;
    }
    const last = graph.pointStart[link + 1]! - 1;
    for (let k = graph.pointStart[link]!; k < last; k++) {
      const ax = graph.pointX[k]!;
      const az = graph.pointZ[k]!;
      const dx = graph.pointX[k + 1]! - ax;
      const dz = graph.pointZ[k + 1]! - az;
      const lengthSquared = dx * dx + dz * dz;
      const t = lengthSquared > 1e-12 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / lengthSquared)) : 0;
      const distance = Math.hypot(ax + dx * t - x, az + dz * t - z);
      if (distance < nearest[link]!) {
        nearest[link] = distance;
        nearestAlong[link] = graph.along[k]! + t * Math.sqrt(lengthSquared);
      }
    }
    closest = Math.min(closest, nearest[link]!);
  }

  const distances = new Float64Array(count).fill(Infinity);
  const arriveAt = new Float64Array(count).fill(-1);
  const heap = new LinkHeap();
  for (let link = 0; link < count; link++) {
    if (nearest[link]! <= closest + reachMeters) {
      arriveAt[link] = nearestAlong[link]!;
      distances[link] = nearestAlong[link]!;
      heap.push(link, nearestAlong[link]!);
    }
  }

  // Each link's predecessors: the links that lead into it.
  const successors = graph.successors;
  const predecessorStart = new Int32Array(count + 1);
  for (let k = 0; k < successors.length; k++) {
    predecessorStart[successors[k]! + 1]!++;
  }
  for (let link = 0; link < count; link++) {
    predecessorStart[link + 1]! += predecessorStart[link]!;
  }
  const predecessors = new Int32Array(successors.length);
  const filled = predecessorStart.slice(0, count);
  for (let link = 0; link < count; link++) {
    for (let k = graph.successorStart[link]!; k < graph.successorStart[link + 1]!; k++) {
      predecessors[filled[successors[k]!]!++] = link;
    }
  }

  while (heap.size > 0) {
    const distance = heap.minKey;
    const link = heap.pop();
    if (distance > distances[link]!) {
      continue; // Reached a shorter way since.
    }
    for (let k = predecessorStart[link]!; k < predecessorStart[link + 1]!; k++) {
      const before = predecessors[k]!;
      const through = distance + graph.length[before]!;
      if (through < distances[before]!) {
        distances[before] = through;
        heap.push(before, through);
      }
    }
  }
  return { distances, arriveAt };
}

/** A binary min-heap of links by distance, for laneRouteTo. */
class LinkHeap {
  private readonly links: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.links.length;
  }

  /** The least distance on the heap (the next pop's). */
  get minKey(): number {
    return this.keys[0]!;
  }

  push(link: number, key: number): void {
    let i = this.links.length;
    this.links.push(link);
    this.keys.push(key);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent]! <= key) {
        break;
      }
      this.links[i] = this.links[parent]!;
      this.keys[i] = this.keys[parent]!;
      i = parent;
    }
    this.links[i] = link;
    this.keys[i] = key;
  }

  /** Takes the link with the least distance off the heap. */
  pop(): number {
    const top = this.links[0]!;
    const link = this.links.pop()!;
    const key = this.keys.pop()!;
    const size = this.links.length;
    if (size > 0) {
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        if (left >= size) {
          break;
        }
        const right = left + 1;
        const child = right < size && this.keys[right]! < this.keys[left]! ? right : left;
        if (this.keys[child]! >= key) {
          break;
        }
        this.links[i] = this.links[child]!;
        this.keys[i] = this.keys[child]!;
        i = child;
      }
      this.links[i] = link;
      this.keys[i] = key;
    }
    return top;
  }
}
