import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG, type SlotSymbolConfig } from '../../../../src/data/config/GameConfig';
import { drawSymbol, slotOdds, slotPayout, slotWin } from '../../../../src/domain/casino/slotMachine';

const SYMBOLS: readonly SlotSymbolConfig[] = [
  { id: 'a', weight: 3, three: 5, pair: 1 },
  { id: 'b', weight: 2, three: 10, pair: 1.5 },
  { id: 'c', weight: 1, three: 50, pair: 4 },
];

describe('drawSymbol', () => {
  it('draws each symbol by its weight', () => {
    expect([0, 0.49, 0.5, 0.83, 0.84, 0.9999].map((roll) => drawSymbol(SYMBOLS, roll))).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

describe('slotWin', () => {
  it('pays three alike their own multiplier', () => {
    expect(slotWin(SYMBOLS, [2, 2, 2])).toEqual({ kind: 'three', symbol: 2, multiplier: 50 });
  });

  it('pays two alike anywhere on the line their pair multiplier', () => {
    expect(slotWin(SYMBOLS, [1, 1, 0])).toEqual({ kind: 'pair', symbol: 1, multiplier: 1.5 });
    expect(slotWin(SYMBOLS, [1, 0, 1])).toEqual({ kind: 'pair', symbol: 1, multiplier: 1.5 });
    expect(slotWin(SYMBOLS, [0, 2, 2])).toEqual({ kind: 'pair', symbol: 2, multiplier: 4 });
  });

  it('pays nothing for three different', () => {
    expect(slotWin(SYMBOLS, [0, 1, 2])).toEqual({ kind: 'none', symbol: -1, multiplier: 0 });
  });

  it('pays whole credits', () => {
    expect(slotPayout({ kind: 'pair', symbol: 1, multiplier: 1.5 }, 50)).toBe(75);
    expect(slotPayout({ kind: 'none', symbol: -1, multiplier: 0 }, 500)).toBe(0);
  });
});

describe('the game’s slot machine', () => {
  const { symbols, bets } = DEFAULT_GAME_CONFIG.casino;

  it('keeps a little of what is bet in the long run, and wins on nearly half the spins', () => {
    const { returnShare, winShare } = slotOdds(symbols);
    expect(returnShare).toBeGreaterThan(0.9);
    expect(returnShare).toBeLessThan(1);
    expect(winShare).toBeGreaterThan(0.4);
    expect(winShare).toBeLessThan(0.5);
  });

  it('never pays less than the bet back for a win, and every win is whole credits at every bet', () => {
    for (const symbol of symbols) {
      expect(symbol.pair, symbol.id).toBeGreaterThanOrEqual(1);
      for (const bet of bets) {
        expect(Number.isInteger(symbol.pair * bet), `${symbol.id} at ${bet}`).toBe(true);
      }
    }
  });
});
