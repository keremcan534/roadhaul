import type { ProductId } from '../../data/config/products';

/** A product on sale, with its price as the store shows it in the player's currency ("€1.99"). */
export interface StoreProduct {
  readonly id: ProductId;
  readonly price: string;
}

/** How a purchase went: bought, waiting on the payment (a cash payment), cancelled, or failed. */
export type PurchaseOutcome = 'purchased' | 'pending' | 'cancelled' | 'failed';

/**
 * In-app purchases, behind an interface so gameplay never talks to a billing SDK: Google Play Billing in the Android
 * app (platform/native/playBilling.ts), a simulated store for development and tests
 * (platform/browser/simulatedStore.ts), or none (NO_STORE: the web game). Only MonetizationService uses it.
 */
export interface PurchaseStore {
  /** Whether purchases can be made here at all. */
  readonly enabled: boolean;
  /** The products on sale and their prices; none when the store cannot be reached. */
  products(ids: readonly ProductId[]): Promise<readonly StoreProduct[]>;
  purchase(id: ProductId): Promise<PurchaseOutcome>;
  /** Everything the player owns, as the store knows it (after a reinstall, or on another phone). */
  owned(): Promise<readonly ProductId[]>;
}

export const NO_STORE: PurchaseStore = Object.freeze({
  enabled: false,
  products: () => Promise.resolve([]),
  purchase: () => Promise.resolve<PurchaseOutcome>('failed'),
  owned: () => Promise.resolve([]),
});
