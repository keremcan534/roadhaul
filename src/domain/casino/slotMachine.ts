import type { SlotSymbolConfig } from '../../data/config/GameConfig';
import type { Credits } from '../../data/units';

/** The slot machine's reels: three, on one line. */
export const REEL_COUNT = 3;

export type SlotWinKind = 'three' | 'pair' | 'none';

/** What a spin's line pays. */
export interface SlotWin {
  readonly kind: SlotWinKind;
  /** The symbol (its index) that made the win; -1 for none. */
  readonly symbol: number;
  /** Times the bet; 0 for none. */
  readonly multiplier: number;
}

/** A symbol for one reel, drawn by weight: `roll` is uniform in [0, 1). */
export function drawSymbol(symbols: readonly SlotSymbolConfig[], roll: number): number {
  let total = 0;
  for (const symbol of symbols) {
    total += symbol.weight;
  }
  let left = roll * total;
  for (let index = 0; index < symbols.length; index++) {
    left -= symbols[index]!.weight;
    if (left < 0) {
      return index;
    }
  }
  return symbols.length - 1;
}

/** What the line `reels` (symbol indices, three) pays: three alike, else two alike anywhere, else nothing. */
export function slotWin(symbols: readonly SlotSymbolConfig[], reels: readonly number[]): SlotWin {
  const [a, b, c] = reels as readonly [number, number, number];
  if (a === b && b === c) {
    return { kind: 'three', symbol: a, multiplier: symbols[a]!.three };
  }
  const paired = a === b || a === c ? a : b === c ? b : -1;
  if (paired >= 0) {
    return { kind: 'pair', symbol: paired, multiplier: symbols[paired]!.pair };
  }
  return { kind: 'none', symbol: -1, multiplier: 0 };
}

/** What a win pays for `bet`, in whole credits. */
export function slotPayout(win: SlotWin, bet: Credits): Credits {
  return Math.round(win.multiplier * bet);
}

/** What the machine pays back of every credit bet in the long run, and how often a spin wins anything: worked out exactly. */
export function slotOdds(symbols: readonly SlotSymbolConfig[]): { readonly returnShare: number; readonly winShare: number } {
  let total = 0;
  for (const symbol of symbols) {
    total += symbol.weight;
  }
  let returnShare = 0;
  let winShare = 0;
  const count = symbols.length;
  const reels = [0, 0, 0];
  for (let a = 0; a < count; a++) {
    for (let b = 0; b < count; b++) {
      for (let c = 0; c < count; c++) {
        reels[0] = a;
        reels[1] = b;
        reels[2] = c;
        const chance = (symbols[a]!.weight * symbols[b]!.weight * symbols[c]!.weight) / total ** 3;
        const { multiplier } = slotWin(symbols, reels);
        returnShare += chance * multiplier;
        winShare += multiplier > 0 ? chance : 0;
      }
    }
  }
  return { returnShare, winShare };
}
