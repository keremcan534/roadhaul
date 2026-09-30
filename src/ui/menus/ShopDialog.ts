import type { ProductId } from '../../data/config/products';
import type { StoreProduct } from '../../systems/monetization/PurchaseStore';
import { button, element } from '../dom';
import type { Strings } from '../i18n';
import { icon, type IconName } from '../icons';

export interface ShopActions {
  readonly onBuy: (id: ProductId) => void;
  readonly onRestore: () => void;
  readonly onClose: () => void;
}

const PRODUCT_ICONS: Readonly<Record<ProductId, IconName>> = { remove_ads: 'close', premium_paints: 'garage' };

/**
 * The shop (spec §35): what the game sells on Google Play, each with its price in the player's currency, bought once
 * and kept for good. Comfort and looks only: nothing in it speeds the game up. It opens from the main menu and from a
 * premium colour in the garage; the purchase itself is Google Play's own sheet. Restoring the purchases reads them from
 * Google Play again (a new phone, or a reinstall).
 */
export class ShopDialog {
  private readonly overlay: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly note: HTMLParagraphElement;
  private readonly restoreButton: HTMLButtonElement;
  private buyButtons: HTMLButtonElement[] = [];

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    private readonly actions: ShopActions,
  ) {
    const document = parent.ownerDocument;
    this.overlay = element(document, 'div', 'screen shop');
    this.overlay.dataset.screen = 'shop';
    this.overlay.hidden = true;
    const panel = element(document, 'div', 'panel shop__panel');
    this.list = element(document, 'div', 'shop__list');
    this.note = element(document, 'p', 'shop__note');
    this.restoreButton = button(document, 'button--ghost shop__restore', strings.t('shop.restore'), 'restore-purchases', actions.onRestore);
    const buttons = element(document, 'div', 'shop__buttons');
    buttons.append(this.restoreButton, button(document, 'button--secondary', strings.t('settings.close'), 'close-shop', actions.onClose));
    panel.append(
      element(document, 'h2', 'panel__title', strings.t('shop.title')),
      element(document, 'p', 'shop__intro', strings.t('shop.intro')),
      this.list,
      this.note,
      buttons,
    );
    this.overlay.append(panel);
    parent.append(this.overlay);
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  /** Opens the shop while its products load. */
  open(): void {
    this.list.replaceChildren();
    this.buyButtons = [];
    this.note.textContent = this.strings.t('shop.loading');
    this.overlay.hidden = false;
  }

  /** Shows what is on sale, and what the player owns already. */
  show(products: readonly StoreProduct[], owned: readonly ProductId[]): void {
    const { strings } = this;
    const document = this.overlay.ownerDocument;
    this.note.textContent = products.length === 0 ? strings.t('shop.unavailable') : '';
    this.buyButtons = [];
    this.list.replaceChildren(
      ...products.map(({ id, price }) => {
        const card = element(document, 'article', 'shop__product');
        card.dataset.product = id;
        const text = element(document, 'div', 'shop__product-text');
        text.append(
          element(document, 'h3', 'shop__product-name', strings.t(`product.${id}.name`)),
          element(document, 'p', 'shop__product-description', strings.t(`product.${id}.description`)),
        );
        card.append(icon(document, PRODUCT_ICONS[id], 'shop__product-icon'), text);
        if (owned.includes(id)) {
          card.classList.add('is-owned');
          card.append(element(document, 'span', 'shop__owned', strings.t('shop.owned')));
        } else {
          const buy = button(document, 'button--primary shop__buy', strings.t('shop.buy', { price }), 'buy-product', () =>
            this.actions.onBuy(id),
          );
          this.buyButtons.push(buy);
          card.append(buy);
        }
        return card;
      }),
    );
  }

  /** While a purchase or a restore is under way, nothing else can start. */
  set busy(busy: boolean) {
    this.restoreButton.disabled = busy;
    for (const buy of this.buyButtons) {
      buy.disabled = busy;
    }
  }

  close(): void {
    this.overlay.hidden = true;
  }

  dispose(): void {
    this.overlay.remove();
  }
}
