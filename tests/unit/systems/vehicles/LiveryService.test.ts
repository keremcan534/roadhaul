import { describe, expect, it } from 'vitest';
import { LIVERIES } from '../../../../src/data/content/liveries';
import type { ProductId } from '../../../../src/data/config/products';
import { bootGame, newCompany, reachLevel } from '../../../support/game';

describe('LiveryService', () => {
  it('starts every truck in the classic, and lists every design with how it is got', async () => {
    const game = await newCompany(1, 10_000);
    const truck = game.garage.activeTruck.instanceId;
    expect(game.liveries.liveryOf(truck).id).toBe('classic');
    const ways = Object.fromEntries(game.liveries.offers().map((offer) => [offer.livery.id, `${offer.way}${offer.owned ? ' owned' : ''}`]));
    expect(ways).toMatchObject({ classic: 'free owned', speed: 'credits', galaxy: 'crate', flames: 'pack', neon: 'pack' });
    expect(game.liveries.offers()).toHaveLength(LIVERIES.length);
  });

  it('sells a design once for the company, from its level, then puts it on any truck for free', async () => {
    const game = await newCompany(1, 10_000);
    const truck = game.garage.activeTruck.instanceId;
    expect(game.liveries.apply(truck, 'speed')).toEqual({ ok: false, error: 'notOwned' });
    expect(game.liveries.buy('chevrons')).toEqual({ ok: false, error: 'locked' });
    expect(game.liveries.buy('galaxy')).toEqual({ ok: false, error: 'notForSale' });
    expect(game.liveries.buy('speed').ok).toBe(true);
    expect(game.economy.credits).toBe(10_000 - 2500);
    expect(game.liveries.buy('speed')).toEqual({ ok: false, error: 'owned' });
    expect(game.liveries.apply(truck, 'speed').ok).toBe(true);
    expect(game.liveries.liveryOf(truck).id).toBe('speed');
    expect(game.liveries.apply(truck, 'speed')).toEqual({ ok: false, error: 'alreadyWorn' });
    expect(game.liveries.apply('truck_999', 'speed')).toEqual({ ok: false, error: 'unknownTruck' });
    expect(game.liveries.apply(truck, 'classic').ok).toBe(true);
    expect(game.liveries.snapshot().worn).toEqual({});

    reachLevel(game, 2);
    game.economy.restore(100);
    expect(game.liveries.buy('chevrons')).toEqual({ ok: false, error: 'insufficientFunds' });
  });

  it('owns a crate\'s design once a crate has given it, and a pack\'s once the pack is bought', async () => {
    const game = await newCompany(1, 0);
    // Gold crates until one gives a design (the crates' luck is the game's own).
    let given: string | null = null;
    for (let i = 0; i < 400 && given === null; i++) {
      game.crates.grant('gold', 'level');
      const opened = game.crates.open('gold');
      given = opened.ok ? opened.value.liveryId : null;
    }
    expect(given).not.toBeNull();
    const offer = game.liveries.offers().find((candidate) => candidate.livery.id === given)!;
    expect(offer).toMatchObject({ way: 'crate', owned: true });

    let receipts: ProductId[] = [];
    await game.monetization.attachStore({
      enabled: true,
      products: (ids) => Promise.resolve(ids.map((id) => ({ id, price: '€1.99' }))),
      purchase: (id) => {
        receipts = [...receipts, id];
        return Promise.resolve('purchased');
      },
      owned: () => Promise.resolve(receipts),
    });
    expect(game.liveries.offers().find((candidate) => candidate.livery.id === 'neon')!.owned).toBe(false);
    await game.monetization.buy('supporter_pack');
    // The bundle brings both packs, the paints and no ads.
    expect(game.liveries.offers().find((candidate) => candidate.livery.id === 'neon')!.owned).toBe(true);
    expect(game.liveries.offers().find((candidate) => candidate.livery.id === 'flames')!.owned).toBe(true);
    expect(game.monetization.adsRemoved).toBe(true);
    expect(game.monetization.premiumPaintAccess).toBe('owned');
  });

  it('letters the company\'s trailers, and keeps it all in the save', async () => {
    const game = await newCompany(1, 10_000);
    expect(game.liveries.setTrailerText('Kuzey lojistik', 'tr')).toEqual({ ok: true, value: 'KUZEY LOJİSTİK' });
    expect(game.liveries.setTrailerText('KUZEY LOJİSTİK', 'tr')).toEqual({ ok: false, error: 'unchanged' });
    game.liveries.buy('speed');
    game.liveries.apply(game.garage.activeTruck.instanceId, 'speed');
    expect(game.session.snapshot().liveries).toEqual({
      bought: ['speed'],
      worn: { [game.garage.activeTruck.instanceId]: 'speed' },
      text: 'KUZEY LOJİSTİK',
    });

    const again = await bootGame(game.storage, 9_000);
    again.session.continueGame();
    expect(again.liveries.trailerText).toBe('KUZEY LOJİSTİK');
    expect(again.liveries.liveryOf(again.garage.activeTruck.instanceId).id).toBe('speed');
    expect(again.liveries.setTrailerText('', 'en')).toEqual({ ok: true, value: null });
  });
});
