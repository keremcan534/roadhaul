import { beforeEach, describe, expect, it, vi } from 'vitest';
import { playBilling } from '../../../src/platform/native/playBilling';
import { MemoryLogger } from '../../support/MemoryLogger';

/** Google Play as the test sets it up: whether it bills, its products, the player's purchases and the next answer. */
const play = vi.hoisted(() => ({
  billing: true,
  products: [] as { identifier: string; priceString: string }[],
  purchases: [] as Record<string, unknown>[],
  nextPurchase: null as (() => Promise<Record<string, unknown>>) | null,
  acknowledged: [] as string[],
  asked: [] as unknown[],
}));

vi.mock('@capgo/native-purchases', () => ({
  PURCHASE_TYPE: { INAPP: 'inapp', SUBS: 'subs' },
  NativePurchases: {
    isBillingSupported: () => Promise.resolve({ isBillingSupported: play.billing }),
    getProducts: (options: unknown) => {
      play.asked.push(options);
      return Promise.resolve({ products: play.products });
    },
    purchaseProduct: (options: unknown) => {
      play.asked.push(options);
      return play.nextPurchase?.() ?? Promise.reject(new Error('No answer set'));
    },
    getPurchases: () => Promise.resolve({ purchases: play.purchases }),
    acknowledgePurchase: ({ purchaseToken }: { purchaseToken: string }) => {
      play.acknowledged.push(purchaseToken);
      return Promise.resolve();
    },
  },
}));

/** A refusal as Capacitor passes it on: a message, and the plugin's code when it gives one. */
const refusal = (message: string, code?: string) => () => Promise.reject(Object.assign(new Error(message), { code }));

describe('playBilling', () => {
  beforeEach(() => {
    play.billing = true;
    play.products = [];
    play.purchases = [];
    play.nextPurchase = null;
    play.acknowledged = [];
    play.asked = [];
  });

  it('is there only where the device can pay through Google Play', async () => {
    play.billing = false;
    expect(await playBilling(new MemoryLogger())).toBeNull();
  });

  it('lists the products set up in the Play Console, in the order asked for, with their prices', async () => {
    const store = (await playBilling(new MemoryLogger()))!;
    play.products = [
      { identifier: 'premium_paints', priceString: '€1.99' },
      { identifier: 'remove_ads', priceString: '€2.99' },
    ];

    expect(await store.products(['remove_ads', 'premium_paints'])).toEqual([
      { id: 'remove_ads', price: '€2.99' },
      { id: 'premium_paints', price: '€1.99' },
    ]);
    expect(play.asked[0]).toEqual({ productIdentifiers: ['remove_ads', 'premium_paints'], productType: 'inapp' });

    play.products = [{ identifier: 'premium_paints', priceString: '€1.99' }];
    expect(await store.products(['remove_ads', 'premium_paints'])).toEqual([{ id: 'premium_paints', price: '€1.99' }]);
  });

  it('tells a purchase made from one cancelled, waiting on payment, owned already or failed', async () => {
    const store = (await playBilling(new MemoryLogger()))!;

    play.nextPurchase = () => Promise.resolve({ productIdentifier: 'remove_ads', purchaseState: '1' });
    expect(await store.purchase('remove_ads')).toBe('purchased');
    expect(play.asked[0]).toEqual({ productIdentifier: 'remove_ads', productType: 'inapp', isConsumable: false });

    play.nextPurchase = refusal('Purchase is not purchased', 'USER_CANCELED');
    expect(await store.purchase('remove_ads')).toBe('cancelled');
    play.nextPurchase = refusal('Purchase is pending');
    expect(await store.purchase('remove_ads')).toBe('pending');
    play.nextPurchase = refusal('Purchase is not purchased', 'ITEM_ALREADY_OWNED');
    expect(await store.purchase('remove_ads')).toBe('purchased');
    play.nextPurchase = refusal('Purchase is not purchased', 'SERVICE_UNAVAILABLE');
    expect(await store.purchase('remove_ads')).toBe('failed');
  });

  it("reads what the player owns: paid for, the game's own, and acknowledged if Play is still waiting for it", async () => {
    const store = (await playBilling(new MemoryLogger()))!;
    play.purchases = [
      { productIdentifier: 'premium_paints', purchaseState: '1', isAcknowledged: true, purchaseToken: 'a' },
      { productIdentifier: 'remove_ads', purchaseState: '1', isAcknowledged: false, purchaseToken: 'b' },
      { productIdentifier: 'remove_ads', purchaseState: '0', purchaseToken: 'c' },
      { productIdentifier: 'coins_1000', purchaseState: '1', purchaseToken: 'd' },
    ];

    expect(await store.owned()).toEqual(['premium_paints', 'remove_ads']);
    expect(play.acknowledged).toEqual(['b']);
  });
});
