import { NativePurchases, PURCHASE_TYPE, type Transaction } from '@capgo/native-purchases';
import type { Logger } from '../../core/logging/Logger';
import { isProductId, type ProductId } from '../../data/config/products';
import type { PurchaseOutcome, PurchaseStore, StoreProduct } from '../../systems/monetization/PurchaseStore';

/** Google Play's purchase state of a paid, valid purchase (Transaction.purchaseState). */
const PURCHASED = '1';

/**
 * Google Play Billing in the Android app (@capgo/native-purchases), for MonetizationService. The game sells one-time
 * products only (data/config/products.ts; their ids are the Play Console's product ids): bought once, kept for good,
 * read back from Play at every start. The plugin acknowledges a purchase as it is made; one paid later (a pending cash
 * payment) is acknowledged here when it turns up, or Play would refund it after three days.
 *
 * The entry point loads this module only in the Android app. Null when this device cannot buy (no Play Store).
 */
export async function playBilling(logger: Logger): Promise<PurchaseStore | null> {
  try {
    const { isBillingSupported } = await NativePurchases.isBillingSupported();
    return isBillingSupported ? new PlayBilling(logger) : null;
  } catch (error) {
    logger.warn('Google Play Billing is not available.', error);
    return null;
  }
}

class PlayBilling implements PurchaseStore {
  readonly enabled = true;

  constructor(private readonly logger: Logger) {}

  async products(ids: readonly ProductId[]): Promise<readonly StoreProduct[]> {
    const { products } = await NativePurchases.getProducts({
      productIdentifiers: [...ids],
      productType: PURCHASE_TYPE.INAPP,
    });
    // In the order asked for; a product not set up in the Play Console is left out.
    return ids.flatMap((id) => {
      const product = products.find((candidate) => candidate.identifier === id);
      return product === undefined ? [] : [{ id, price: product.priceString }];
    });
  }

  async purchase(id: ProductId): Promise<PurchaseOutcome> {
    try {
      const transaction = await NativePurchases.purchaseProduct({
        productIdentifier: id,
        productType: PURCHASE_TYPE.INAPP,
        isConsumable: false,
      });
      return transaction.purchaseState === undefined || transaction.purchaseState === PURCHASED ? 'purchased' : 'pending';
    } catch (error) {
      return outcomeOf(error);
    }
  }

  async owned(): Promise<readonly ProductId[]> {
    const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.INAPP });
    const owned: ProductId[] = [];
    for (const purchase of purchases) {
      if (purchase.purchaseState !== PURCHASED || !isProductId(purchase.productIdentifier)) {
        continue;
      }
      owned.push(purchase.productIdentifier);
      await this.acknowledge(purchase);
    }
    return owned;
  }

  /** A purchase paid after it was made (a pending payment) is acknowledged on its first sight. */
  private async acknowledge(purchase: Transaction): Promise<void> {
    if (purchase.isAcknowledged !== false || purchase.purchaseToken === undefined) {
      return;
    }
    try {
      await NativePurchases.acknowledgePurchase({ purchaseToken: purchase.purchaseToken });
    } catch (error) {
      this.logger.warn(`The purchase of ${purchase.productIdentifier} could not be acknowledged yet.`, error);
    }
  }
}

/**
 * How a refused purchase went, from the plugin's error: the player cancelled; it waits on a payment (the plugin says
 * so in the message); the player owns it already (bought on another phone: it counts as bought); or it failed.
 */
function outcomeOf(error: unknown): PurchaseOutcome {
  const { code, message } = (typeof error === 'object' && error !== null ? error : {}) as {
    code?: unknown;
    message?: unknown;
  };
  if (code === 'USER_CANCELED') {
    return 'cancelled';
  }
  if (code === 'ITEM_ALREADY_OWNED') {
    return 'purchased';
  }
  return typeof message === 'string' && /pending/i.test(message) ? 'pending' : 'failed';
}
