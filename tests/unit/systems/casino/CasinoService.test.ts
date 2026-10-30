import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { SeededRandom } from '../../../../src/core/random/SeededRandom';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { EconomyService } from '../../../../src/systems/economy/EconomyService';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { CasinoService } from '../../../../src/systems/casino/CasinoService';
import { MemoryLogger } from '../../../support/MemoryLogger';

const CONFIG = DEFAULT_GAME_CONFIG.casino;

/** The company with `credits`; the reels draw from `rolls` in turn (or a seeded run). */
function setup(credits: number, rolls?: readonly number[]) {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const economy = new EconomyService(events, DEFAULT_GAME_CONFIG.economy, logger);
  economy.restore(credits);
  const seeded = new SeededRandom(7);
  let next = 0;
  const random = rolls === undefined ? () => seeded.next() : () => rolls[next++ % rolls.length]!;
  const casino = new CasinoService(CONFIG, economy, random, events, logger);
  const spun: GameEvents['SlotSpun'][] = [];
  events.on('SlotSpun', (event) => spun.push(event));
  return { casino, economy, spun };
}

/** A roll that lands on symbol `index` of the config's reel. */
function rollFor(index: number): number {
  const total = CONFIG.symbols.reduce((sum, symbol) => sum + symbol.weight, 0);
  const before = CONFIG.symbols.slice(0, index).reduce((sum, symbol) => sum + symbol.weight, 0);
  return (before + 0.5) / total;
}

describe('CasinoService', () => {
  it('takes the bet and pays three alike, telling the game', () => {
    const trophy = CONFIG.symbols.length - 1;
    const { casino, economy, spun } = setup(1000, [rollFor(trophy)]);

    const spin = casino.spin(100);
    expect(spin.ok && spin.value).toMatchObject({ bet: 100, reels: [trophy, trophy, trophy], payout: 25_000 });
    expect(economy.credits).toBe(1000 - 100 + 25_000);
    expect(spun).toEqual([{ bet: 100, payout: 25_000, kind: 'three', multiplier: 250 }]);
    expect(casino.sessionNet).toBe(24_900);
  });

  it('keeps the bet when the line wins nothing', () => {
    const { casino, economy } = setup(1000, [rollFor(0), rollFor(1), rollFor(2)]);

    const spin = casino.spin(50);
    expect(spin.ok && spin.value.payout).toBe(0);
    expect(economy.credits).toBe(950);
    expect(casino.sessionNet).toBe(-50);
    expect(casino.sessionSpins).toBe(1);
  });

  it('refuses a bet not on offer, or one the company cannot pay, without charging', () => {
    const { casino, economy, spun } = setup(80);

    expect(casino.spin(75)).toEqual({ ok: false, error: 'unknownBet' });
    expect(casino.spin(100)).toEqual({ ok: false, error: 'insufficientFunds' });
    expect(economy.credits).toBe(80);
    expect(spun).toEqual([]);
  });

  it('pays back what the odds say over many spins', () => {
    const { casino } = setup(100_000_000);
    for (let spin = 0; spin < 200_000; spin++) {
      casino.spin(100);
    }
    const returned = 1 + casino.sessionNet / (200_000 * 100);
    expect(returned).toBeGreaterThan(0.9);
    expect(returned).toBeLessThan(1.01);
  });
});
