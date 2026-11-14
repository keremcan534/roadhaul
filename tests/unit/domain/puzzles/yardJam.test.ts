import { describe, expect, it } from 'vitest';
import {
  EXIT_ROW,
  generateYardJam,
  isYardCleared,
  slideRange,
  slideVehicle,
  solveYardJam,
  YARD_SIZE,
  yardJamSolution,
  type YardJam,
} from '../../../../src/domain/puzzles/yardJam';

/**
 * The truck on the left of the gate's row; a van across the row at column 3,
 * kept from going up by a van over it and from going down by a lorry under
 * it: the top van moves aside, the blocking van goes up, the truck goes out.
 */
const JAMMED: YardJam = [
  { row: EXIT_ROW, col: 0, length: 2, horizontal: true },
  { row: 1, col: 3, length: 2, horizontal: false },
  { row: 0, col: 3, length: 2, horizontal: true },
  { row: 4, col: 2, length: 3, horizontal: true },
];

/** Every bay holds at most one vehicle, and every vehicle lies inside the yard. */
function expectSound(yard: YardJam): void {
  const taken = new Set<number>();
  for (const vehicle of yard) {
    for (let k = 0; k < vehicle.length; k++) {
      const row = vehicle.horizontal ? vehicle.row : vehicle.row + k;
      const col = vehicle.horizontal ? vehicle.col + k : vehicle.col;
      expect(row).toBeGreaterThanOrEqual(0);
      expect(col).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(YARD_SIZE);
      expect(col).toBeLessThan(YARD_SIZE);
      expect(taken.has(row * YARD_SIZE + col)).toBe(false);
      taken.add(row * YARD_SIZE + col);
    }
  }
}

describe('Yard Jam', () => {
  it('slides a vehicle along its line as far as the others let it', () => {
    expect(slideRange(JAMMED, 0)).toEqual({ min: 0, max: 1 }); // Up to the van across the row.
    expect(slideRange(JAMMED, 1)).toEqual({ min: 1, max: 2 }); // Not up; down one, still across the row.
    expect(slideRange(JAMMED, 2)).toEqual({ min: 0, max: 4 });
    expect(slideRange(JAMMED, 3)).toEqual({ min: 0, max: 3 });

    const moved = slideVehicle(JAMMED, 2, 0);
    expect(moved[2]).toEqual({ row: 0, col: 0, length: 2, horizontal: true });
    expect(JAMMED[2]!.col).toBe(3); // The yard given is left alone.
    expect(slideRange(moved, 1)).toEqual({ min: 0, max: 2 });
    expect(() => slideVehicle(JAMMED, 1, 0)).toThrow();
    expect(() => slideVehicle(JAMMED, 0, 4)).toThrow();
  });

  it('is cleared once the truck reaches the gate', () => {
    let yard = slideVehicle(JAMMED, 2, 4);
    yard = slideVehicle(yard, 1, 0);
    expect(isYardCleared(yard)).toBe(false);

    yard = slideVehicle(yard, 0, 4);

    expect(isYardCleared(yard)).toBe(true);
    expect(solveYardJam(yard)).toBe(0);
  });

  it('finds the fewest moves, and the moves themselves', () => {
    expect(solveYardJam(JAMMED)).toBe(3);

    const solution = yardJamSolution(JAMMED)!;
    let yard = JAMMED;
    for (const { index, position } of solution) {
      yard = slideVehicle(yard, index, position);
    }
    expect(solution).toHaveLength(3);
    expect(isYardCleared(yard)).toBe(true);
  });

  it('knows a yard that can never be cleared', () => {
    // A lorry lying across the gate's row in front of the truck.
    const stuck: YardJam = [
      { row: EXIT_ROW, col: 0, length: 2, horizontal: true },
      { row: EXIT_ROW, col: 3, length: 3, horizontal: true },
    ];

    expect(solveYardJam(stuck)).toBeNull();
    expect(yardJamSolution(stuck)).toBeNull();
  });

  it('deals the same yard for the same seed, a sound one that takes the moves it says', () => {
    for (const seed of [1, 2, 20_400, 20_401, 987_654]) {
      const puzzle = generateYardJam(seed);
      expect(generateYardJam(seed)).toEqual(puzzle);
      expectSound(puzzle.yard);
      expect(puzzle.yard[0]).toMatchObject({ row: EXIT_ROW, length: 2, horizontal: true });
      expect(puzzle.yard.slice(1).some((vehicle) => vehicle.horizontal && vehicle.row === EXIT_ROW)).toBe(false);
      expect(solveYardJam(puzzle.yard)).toBe(puzzle.moves);
    }
    expect(generateYardJam(5)).not.toEqual(generateYardJam(6));
  });

  it('deals puzzles worth the name: most take nine moves or more', () => {
    const moves = Array.from({ length: 20 }, (_, day) => generateYardJam(20_400 + day).moves);

    expect(Math.min(...moves)).toBeGreaterThanOrEqual(4);
    expect(moves.filter((count) => count >= 9).length).toBeGreaterThanOrEqual(15);
  });
});
