import { describe, expect, it } from 'vitest';
import { MemoryGame } from '../../../../src/domain/games/memoryGame';

/** The two cards of each face, by face. */
function pairsOf(game: MemoryGame): [number, number][] {
  const where = new Map<number, number[]>();
  game.faces.forEach((face, index) => where.set(face, [...(where.get(face) ?? []), index]));
  return [...where.values()].map(([a, b]) => [a!, b!]);
}

describe('MemoryGame', () => {
  it('deals each face twice, shuffled the same for the same seed', () => {
    const game = new MemoryGame(8, 42);

    expect(game.faces).toHaveLength(16);
    expect([...game.faces].sort((a, b) => a - b)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7]);
    expect(new MemoryGame(8, 42).faces).toEqual(game.faces);
    expect(new MemoryGame(8, 43).faces).not.toEqual(game.faces);
    expect(() => new MemoryGame(0, 1)).toThrow();
  });

  it('keeps a pair up, and turns two that differ back down once seen', () => {
    const game = new MemoryGame(4, 7);
    const [[a, b], [c]] = pairsOf(game) as [[number, number], [number, number]];

    expect(game.flip(a)).toBe('first');
    expect(game.flip(a)).toBe('ignored'); // Already up.
    expect(game.flip(b)).toBe('pair');
    expect(game.pairsFound).toBe(1);

    expect(game.flip(c)).toBe('first');
    const other = game.faces.findIndex((face, index) => face !== game.faces[c] && game.up[index] === 0);
    expect(game.flip(other)).toBe('miss');
    expect(game.missShowing).toBe(true);
    expect(game.flip(game.faces.findIndex((_, index) => game.up[index] === 0))).toBe('ignored'); // Wait for them to go down.
    game.hideMiss();

    expect(game.up[c]).toBe(0);
    expect(game.up[other]).toBe(0);
    expect(game.up[a]).toBe(1);
    expect(game.turns).toBe(2);
  });

  it('is won when every pair is up, in as many turns as pairs at best', () => {
    const game = new MemoryGame(6, 99);

    for (const [a, b] of pairsOf(game)) {
      game.flip(a);
      game.flip(b);
    }

    expect(game.won).toBe(true);
    expect(game.turns).toBe(6);
    expect(game.flip(0)).toBe('ignored');
  });
});
