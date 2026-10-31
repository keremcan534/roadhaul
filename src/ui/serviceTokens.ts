import { button, element } from './dom';
import type { Strings } from './i18n';
import { withIcon } from './icons';

/** A free service a crate's token pays for, where the truck stands: how many tokens, and how to use one. */
export interface TokenService {
  readonly count: number;
  readonly onUse: () => void;
}

/**
 * The crates' free fill-up and repair tokens (SupplyService), as buttons
 * under the pump's and the workshop's: only for what can be done where the
 * truck stands, and only with a token held. Null when there is none to show.
 */
export function serviceTokens(
  document: Document,
  strings: Strings,
  services: { readonly refuel: TokenService | null; readonly repair: TokenService | null },
): HTMLElement | null {
  const usable = [services.refuel, services.repair].some((service) => service !== null && service.count > 0);
  if (!usable) {
    return null;
  }
  const root = element(document, 'div', 'service-discounts service-tokens');
  const buttons = element(document, 'div', 'service-discounts__buttons');
  const add = (service: TokenService | null, key: 'supplies.useRefuel' | 'supplies.useRepair', action: string): void => {
    if (service === null || service.count <= 0) {
      return;
    }
    const node = button(document, 'button--secondary service-discounts__button', strings.t(key, { count: service.count }), action, service.onUse);
    buttons.append(withIcon(node, 'crate'));
  };
  add(services.refuel, 'supplies.useRefuel', 'refuel-token');
  add(services.repair, 'supplies.useRepair', 'repair-token');
  root.append(buttons);
  return root;
}
