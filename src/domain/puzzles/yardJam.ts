import { SeededRandom } from '../../core/random/SeededRandom';

/**
 * Yard Jam, the diner's puzzle (the owner's request for puzzles): a jammed
 * depot yard of YARD_SIZE × YARD_SIZE bays, each vehicle two or three bays
 * long, lying along a row or a column. A vehicle slides along its length,
 * as far as the others let it. The first vehicle is the company's truck, in
 * the gate's row (EXIT_ROW); the yard is cleared when it reaches the gate at
 * that row's right end. A move is one vehicle sliding, however far.
 */
export const YARD_SIZE = 6;
/** The row of the company's truck and the gate, counted from the top. */
export const EXIT_ROW = 2;

/** One vehicle in the yard: its top-left bay, its length and which way it lies. */
export interface YardVehicle {
  readonly row: number;
  readonly col: number;
  readonly length: 2 | 3;
  /** Lies along its row (slides left and right); otherwise along its column. */
  readonly horizontal: boolean;
}

/** The yard: its vehicles, the company's truck first. */
export type YardJam = readonly YardVehicle[];

/** The company's truck stands at the gate. */
export function isYardCleared(yard: YardJam): boolean {
  const truck = yard[0]!;
  return truck.col + truck.length === YARD_SIZE;
}

/** Where vehicle `index` may slide to: the least and most of its column (lying along a row) or row, as the others leave room. */
export function slideRange(yard: YardJam, index: number): { readonly min: number; readonly max: number } {
  const taken = occupancy(yard, index);
  const vehicle = yard[index]!;
  const start = vehicle.horizontal ? vehicle.col : vehicle.row;
  const at = (position: number): number =>
    vehicle.horizontal ? vehicle.row * YARD_SIZE + position : position * YARD_SIZE + vehicle.col;
  let min = start;
  while (min > 0 && taken[at(min - 1)] === 0) {
    min--;
  }
  let max = start;
  while (max + vehicle.length < YARD_SIZE && taken[at(max + vehicle.length)] === 0) {
    max++;
  }
  return { min, max };
}

/** The yard with vehicle `index` slid to `position` (its column, lying along a row, else its row). Throws past where it can go. */
export function slideVehicle(yard: YardJam, index: number, position: number): YardJam {
  const range = slideRange(yard, index);
  if (!Number.isInteger(position) || position < range.min || position > range.max) {
    throw new Error(`Vehicle ${index} cannot slide to ${position} (${range.min}..${range.max}).`);
  }
  const vehicle = yard[index]!;
  const moved: YardVehicle = vehicle.horizontal ? { ...vehicle, col: position } : { ...vehicle, row: position };
  return yard.map((other, i) => (i === index ? moved : other));
}

/**
 * The fewest moves that clear `yard` (breadth first over every arrangement
 * reachable), or null when it cannot be cleared (or more than `maxStates`
 * arrangements would need looking at). 0 for a yard already cleared.
 */
export function solveYardJam(yard: YardJam, maxStates = 250_000): number | null {
  return searchYard(yard, maxStates)?.moves ?? null;
}

/**
 * The moves that clear `yard` in the fewest: each the vehicle's index and
 * where it slides to; null as solveYardJam. For a hint, and for tests.
 */
export function yardJamSolution(yard: YardJam, maxStates = 250_000): { readonly index: number; readonly position: number }[] | null {
  return searchYard(yard, maxStates)?.path ?? null;
}

/** What a puzzle generator settles for. */
export interface YardJamOptions {
  /** The fewest moves a puzzle should take; the hardest found is taken if none does. */
  readonly minMoves: number;
  /** Puzzles tried at most. */
  readonly attempts: number;
}

const DEFAULT_OPTIONS: YardJamOptions = { minMoves: 9, attempts: 60 };
/** Vehicles besides the truck in a generated yard, at least and at most. */
const MIN_BLOCKERS = 8;
const MAX_BLOCKERS = 12;
/** A blocker is a three-bay lorry this often, otherwise a two-bay van. */
const LORRY_SHARE = 0.3;

/**
 * A yard to clear, the same for the same `seed` (the day's for the daily
 * puzzle), with the fewest moves it takes: yards are dealt at random (the
 * truck in the gate's row on the left, eight to twelve vehicles about it,
 * none lying across the gate's row, which could never clear) until one takes
 * `minMoves` or more, else the hardest of `attempts`. Not for a frame:
 * each try is searched through.
 */
export function generateYardJam(seed: number, options: Partial<YardJamOptions> = {}): { readonly yard: YardJam; readonly moves: number } {
  const { minMoves, attempts } = { ...DEFAULT_OPTIONS, ...options };
  const random = new SeededRandom(Math.imul(seed ^ 0x5f356495, 0x2c1b3c6d) ^ 0x297a2d39);
  let best: { yard: YardJam; moves: number } | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const yard = dealYard(random);
    const moves = solveYardJam(yard, 20_000);
    if (moves === null || moves === 0) {
      continue;
    }
    if (best === null || moves > best.moves) {
      best = { yard, moves };
    }
    if (moves >= minMoves) {
      break;
    }
  }
  if (best === null) {
    // Never in practice (a yard with the truck alone in its row clears in one), but always a puzzle.
    const yard: YardJam = [{ row: EXIT_ROW, col: 0, length: 2, horizontal: true }, { row: 1, col: 3, length: 3, horizontal: false }];
    return { yard, moves: solveYardJam(yard)! };
  }
  return best;
}

/** One random yard: the truck, then blockers wherever they fit. */
function dealYard(random: SeededRandom): YardJam {
  const yard: YardVehicle[] = [{ row: EXIT_ROW, col: random.int(0, 1), length: 2, horizontal: true }];
  const taken = new Uint8Array(YARD_SIZE * YARD_SIZE);
  mark(taken, yard[0]!);
  const wanted = random.int(MIN_BLOCKERS, MAX_BLOCKERS);
  for (let tries = 0; tries < 200 && yard.length - 1 < wanted; tries++) {
    const length: 2 | 3 = random.next() < LORRY_SHARE ? 3 : 2;
    const horizontal = random.next() < 0.5;
    const row = horizontal ? random.int(0, YARD_SIZE - 1) : random.int(0, YARD_SIZE - length);
    const col = horizontal ? random.int(0, YARD_SIZE - length) : random.int(0, YARD_SIZE - 1);
    if (horizontal && row === EXIT_ROW) {
      continue;
    }
    const vehicle: YardVehicle = { row, col, length, horizontal };
    if (fits(taken, vehicle)) {
      mark(taken, vehicle);
      yard.push(vehicle);
    }
  }
  return yard;
}

function fits(taken: Uint8Array, vehicle: YardVehicle): boolean {
  for (let k = 0; k < vehicle.length; k++) {
    const row = vehicle.horizontal ? vehicle.row : vehicle.row + k;
    const col = vehicle.horizontal ? vehicle.col + k : vehicle.col;
    if (taken[row * YARD_SIZE + col] !== 0) {
      return false;
    }
  }
  return true;
}

function mark(taken: Uint8Array, vehicle: YardVehicle): void {
  for (let k = 0; k < vehicle.length; k++) {
    const row = vehicle.horizontal ? vehicle.row : vehicle.row + k;
    const col = vehicle.horizontal ? vehicle.col + k : vehicle.col;
    taken[row * YARD_SIZE + col] = 1;
  }
}

/** The bays taken by every vehicle but `except`. */
function occupancy(yard: YardJam, except = -1): Uint8Array {
  const taken = new Uint8Array(YARD_SIZE * YARD_SIZE);
  for (let i = 0; i < yard.length; i++) {
    if (i !== except) {
      mark(taken, yard[i]!);
    }
  }
  return taken;
}

/**
 * Breadth first over the arrangements. Each is the vehicles' positions along
 * their lines (the other coordinate never changes), kept as one number in
 * base YARD_SIZE: a move adds (to − from) × YARD_SIZE^index, so no array is
 * copied, and an arrangement's bays are marked from its number.
 */
function searchYard(
  yard: YardJam,
  maxStates: number,
): { moves: number; path: { index: number; position: number }[] } | null {
  const count = yard.length;
  const powers: number[] = [];
  for (let i = 0, power = 1; i < count; i++, power *= YARD_SIZE) {
    powers.push(power);
  }
  // Each vehicle's line: the bay of position p is base + p × step.
  const base = yard.map((vehicle) => (vehicle.horizontal ? vehicle.row * YARD_SIZE : vehicle.col));
  const step = yard.map((vehicle) => (vehicle.horizontal ? 1 : YARD_SIZE));
  const lengths = yard.map((vehicle) => vehicle.length);
  let startKey = 0;
  for (let i = count - 1; i >= 0; i--) {
    const vehicle = yard[i]!;
    startKey = startKey * YARD_SIZE + (vehicle.horizontal ? vehicle.col : vehicle.row);
  }
  const goal = YARD_SIZE - lengths[0]!;
  if (startKey % YARD_SIZE === goal) {
    return { moves: 0, path: [] };
  }
  // Each arrangement seen, and the one it came from.
  const cameFrom = new Map<number, number>([[startKey, -1]]);
  let frontier: number[] = [startKey];
  const taken = new Uint8Array(YARD_SIZE * YARD_SIZE);
  const positions = new Int8Array(count);
  for (let moves = 1; frontier.length > 0; moves++) {
    const next: number[] = [];
    for (const key of frontier) {
      taken.fill(0);
      let rest = key;
      for (let i = 0; i < count; i++) {
        const position = rest % YARD_SIZE;
        rest = (rest - position) / YARD_SIZE;
        positions[i] = position;
        for (let k = 0; k < lengths[i]!; k++) {
          taken[base[i]! + (position + k) * step[i]!] = 1;
        }
      }
      for (let i = 0; i < count; i++) {
        const position = positions[i]!;
        const length = lengths[i]!;
        for (let direction = -1; direction <= 1; direction += 2) {
          for (let to = position + direction; ; to += direction) {
            // The bay it moves into: behind it going back, past its front going on.
            const entering = direction < 0 ? to : to + length - 1;
            if (entering < 0 || entering >= YARD_SIZE || taken[base[i]! + entering * step[i]!] !== 0) {
              break;
            }
            const movedKey = key + (to - position) * powers[i]!;
            if (cameFrom.has(movedKey)) {
              continue;
            }
            cameFrom.set(movedKey, key);
            if (i === 0 && to === goal) {
              return { moves, path: pathTo(cameFrom, movedKey, count) };
            }
            if (cameFrom.size > maxStates) {
              return null;
            }
            next.push(movedKey);
          }
        }
      }
    }
    frontier = next;
  }
  return null;
}

/** The moves from the first arrangement to `key`: each the one vehicle whose position differs from the arrangement before. */
function pathTo(cameFrom: ReadonlyMap<number, number>, key: number, count: number): { index: number; position: number }[] {
  const path: { index: number; position: number }[] = [];
  for (let child = key, parent = cameFrom.get(key)!; parent !== -1; child = parent, parent = cameFrom.get(parent)!) {
    let a = child;
    let b = parent;
    for (let i = 0; i < count; i++) {
      const childPosition = a % YARD_SIZE;
      const parentPosition = b % YARD_SIZE;
      if (childPosition !== parentPosition) {
        path.push({ index: i, position: childPosition });
        break;
      }
      a = (a - childPosition) / YARD_SIZE;
      b = (b - parentPosition) / YARD_SIZE;
    }
  }
  return path.reverse();
}
