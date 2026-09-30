import type { Credits } from '../data/units';
import type { ServiceDiscountOffer } from '../systems/monetization/MonetizationService';
import { button, element } from './dom';
import type { Strings } from './i18n';
import { withIcon } from './icons';

/** What the half-price services need to know: the offer, and whether it comes without an ad (ads removed). */
export interface ServiceDiscountSource {
  readonly serviceDiscountOffer: ServiceDiscountOffer | null;
  readonly adsRemoved: boolean;
}

/** A service the truck can have here now, at its full price and whether the company can pay the discounted one. */
export interface DiscountedService {
  readonly fullCost: Credits;
  readonly affordable: (cost: Credits) => boolean;
  readonly onTake: () => void;
}

/**
 * The rewarded half-price services (MonetizationService), under the pump's and the workshop's own buttons: how many
 * are left today, and a button for each service due here, at its discounted price, marked with the ad's play sign
 * unless ads are removed. Null when there is none to offer.
 */
export function serviceDiscounts(
  document: Document,
  strings: Strings,
  source: ServiceDiscountSource,
  services: { readonly refuel: DiscountedService | null; readonly repair: DiscountedService | null },
): HTMLElement | null {
  const offer = source.serviceDiscountOffer;
  if (offer === null || (services.refuel === null && services.repair === null)) {
    return null;
  }
  const withAd = !source.adsRemoved;
  const root = element(document, 'div', 'service-discounts');
  root.append(
    element(document, 'p', 'service-discounts__note', strings.t(withAd ? 'ads.discount' : 'ads.discountFree', { count: offer.left })),
  );
  const buttons = element(document, 'div', 'service-discounts__buttons');
  const add = (service: DiscountedService | null, key: 'rest.refuel' | 'rest.repair', action: string): void => {
    if (service === null) {
      return;
    }
    const cost = Math.round(service.fullCost * (1 - offer.discount));
    const node = button(document, 'button--secondary service-discounts__button', strings.t(key, { cost: strings.money(cost) }), action, service.onTake);
    node.disabled = !service.affordable(cost);
    buttons.append(withAd ? withIcon(node, 'play') : node);
  };
  add(services.refuel, 'rest.refuel', 'refuel-discount');
  add(services.repair, 'rest.repair', 'repair-discount');
  root.append(buttons);
  return root;
}
