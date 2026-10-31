import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { deliver, newCompany, parkAtDepot } from '../../../support/game';

describe('SupplyService', () => {
  it('keeps the parts and boosters crates give, and saves them', async () => {
    const game = await newCompany(1, 1000);
    game.supplies.add(3, 'pay_boost');
    game.supplies.add(2, null);
    expect(game.supplies.parts).toBe(5);
    expect(game.supplies.count('pay_boost')).toBe(1);
    expect(game.session.snapshot().supplies).toEqual({ parts: 5, boosters: { pay_boost: 1 }, payBoostLeft: 0, xpBoostLeft: 0 });
  });

  it('runs a pay boost and an experience boost over the next deliveries, once started', async () => {
    const game = await newCompany(1, 0);
    const config = DEFAULT_GAME_CONFIG.crates.boosters;
    expect(game.supplies.start('pay_boost')).toEqual({ ok: false, error: 'none' });
    game.supplies.add(0, 'pay_boost');
    game.supplies.add(0, 'xp_boost');
    expect(game.supplies.start('pay_boost')).toEqual({ ok: true, value: config.payDeliveries });
    expect(game.supplies.start('xp_boost')).toEqual({ ok: true, value: config.xpDeliveries });
    game.supplies.add(0, 'pay_boost');
    expect(game.supplies.start('pay_boost')).toEqual({ ok: false, error: 'running' });

    const xpBefore = game.company.xp;
    deliver(game, 'first_package');
    const completed = game.supplies.lastDelivery;
    expect(completed.pay).toBeGreaterThan(0);
    expect(completed.xp).toBeGreaterThan(0);
    // The delivery's own experience, then as much again.
    expect(game.company.xp - xpBefore).toBe(2 * completed.xp);
    expect(game.supplies.payBoostLeft).toBe(config.payDeliveries - 1);
    expect(game.supplies.xpBoostLeft).toBe(config.xpDeliveries - 1);
  });

  it('fills the tank and repairs the truck for free with a token, at the yard', async () => {
    const game = await newCompany(1, 0);
    expect(game.supplies.useFreeRefuel()).toEqual({ ok: false, error: 'none' });
    game.supplies.add(0, 'free_refuel');
    game.supplies.add(0, 'free_repair');
    game.fuel.restore(10);
    // Away from a pump, the token stays.
    expect(game.supplies.useFreeRefuel()).toEqual({ ok: false, error: 'notAtServicePoint' });
    expect(game.supplies.count('free_refuel')).toBe(1);
    parkAtDepot(game);
    const filled = game.supplies.useFreeRefuel();
    expect(filled.ok && filled.value.cost).toBe(0);
    expect(game.fuel.missingLiters).toBeLessThan(0.5);
    expect(game.supplies.count('free_refuel')).toBe(0);
    // Undamaged: the token stays.
    expect(game.supplies.useFreeRepair()).toEqual({ ok: false, error: 'notDamaged' });
    expect(game.supplies.count('free_repair')).toBe(1);
    expect(game.economy.credits).toBe(0);
  });

  it('takes the parts off an upgrade\'s price as it is bought, no more of them than it takes', async () => {
    const game = await newCompany(1, 50_000);
    const partCredits = DEFAULT_GAME_CONFIG.crates.partCredits;
    const offer = game.upgrades.offers().find((candidate) => candidate.next !== null && !candidate.next.locked)!;
    const cost = offer.next!.cost;
    game.supplies.add(2, null);
    const next = game.upgrades.offers().find((candidate) => candidate.upgrade.id === offer.upgrade.id)!.next!;
    expect(next).toMatchObject({ partsUsed: 2, partsCredit: 2 * partCredits, price: cost - 2 * partCredits });
    expect(game.upgrades.buy(offer.upgrade.id).ok).toBe(true);
    expect(game.economy.credits).toBe(50_000 - (cost - 2 * partCredits));
    expect(game.supplies.parts).toBe(0);

    // More parts than a price takes: only those it takes.
    game.supplies.add(1000, null);
    const pricey = game.upgrades.offers().find((candidate) => candidate.next !== null && !candidate.next.locked)!.next!;
    expect(pricey.price).toBe(0);
    expect(pricey.partsUsed).toBe(Math.ceil(pricey.cost / partCredits));
  });
});
