import type { KeyValueStorage } from '../../core/storage/KeyValueStorage';
import { isProductId, type ProductId } from '../../data/config/products';
import type { PurchaseOutcome, PurchaseStore } from '../../systems/monetization/PurchaseStore';
import { simulatedSheet } from './simulatedSheet';

/** What the simulated store has sold on this browser: its own record, as Google Play keeps the player's. */
const RECEIPTS_KEY = 'roadhaul.simulatedStore';

const PRICES: Readonly<Record<ProductId, string>> = { remove_ads: '€2.99', premium_paints: '€1.99' };

/**
 * A simulated store, for development and the end-to-end tests (`?store=simulated`): each purchase asks on a sheet,
 * to buy or to cancel, for nothing. What it sold is kept in this browser, so restoring purchases finds it again.
 */
export function simulatedStore(document: Document, storage: KeyValueStorage): PurchaseStore {
  const receipts = (): ProductId[] => {
    try {
      const stored: unknown = JSON.parse(storage.getItem(RECEIPTS_KEY) ?? '[]');
      return Array.isArray(stored) ? stored.filter(isProductId) : [];
    } catch {
      return [];
    }
  };
  return {
    enabled: true,
    products: (ids) => Promise.resolve(ids.map((id) => ({ id, price: PRICES[id] }))),
    purchase: (id) =>
      new Promise<PurchaseOutcome>((resolve) => {
        const sheet = simulatedSheet(document, `Simulated purchase: ${id}`);
        sheet.status.textContent = `${PRICES[id]}, for nothing.`;
        sheet.button('Buy', 'simulated-buy', () => {
          const sold = receipts();
          storage.setItem(RECEIPTS_KEY, JSON.stringify(sold.includes(id) ? sold : [...sold, id]));
          resolve('purchased');
        });
        sheet.button('Cancel', 'simulated-cancel', () => resolve('cancelled'));
      }),
    owned: () => Promise.resolve(receipts()),
  };
}
