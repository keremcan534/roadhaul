import type { OwnedTruck, PaintOffer } from '../../systems/vehicles/GarageService';
import { button, element } from '../dom';
import type { Strings } from '../i18n';

/** What the paint picker of an owned truck needs to know. */
export interface PaintPickerState {
  readonly truck: OwnedTruck;
  readonly offers: readonly PaintOffer[];
  readonly canAfford: (price: number) => boolean;
}

/**
 * The paint shop for the truck being driven: a swatch per colour, the
 * factory colour first (free), then the paints; colours for bigger companies
 * shown locked. Tapping a swatch picks it, and `onPick` shows it on the
 * truck; the button under them paints the truck, for the price it names, so
 * a stray tap never costs anything. The premium colours come last, marked:
 * free once bought, and until then a tap on one opens the shop (`onPremium`).
 */
export function paintPicker(
  document: Document,
  strings: Strings,
  state: PaintPickerState,
  onPaint: (instanceId: string, paintId: string | null) => void,
  onPick?: (paintId: string | null) => void,
  onPremium?: () => void,
): HTMLElement {
  const { truck } = state;
  const current = truck.paint?.id ?? null;
  const root = element(document, 'div', 'paint-picker');
  const label = element(document, 'p', 'paint-picker__label');
  const swatches = element(document, 'div', 'paint-picker__swatches');
  swatches.setAttribute('role', 'radiogroup');
  swatches.setAttribute('aria-label', strings.t('hq.garage.paint'));
  let chosen: string | null = current;
  const apply = button(document, 'button--secondary paint-picker__apply', '', 'paint-truck', () => onPaint(truck.instanceId, chosen));

  const nameOf = (paintId: string | null): string =>
    paintId === null ? strings.t('hq.garage.factoryPaint') : strings.t(`paint.${paintId}.name`);
  const choices: { readonly paintId: string | null; readonly price: number; readonly node: HTMLButtonElement }[] = [];
  const pick = (paintId: string | null): void => {
    chosen = paintId;
    for (const choice of choices) {
      choice.node.classList.toggle('is-chosen', choice.paintId === paintId);
      choice.node.setAttribute('aria-checked', String(choice.paintId === paintId));
    }
    const price = choices.find((choice) => choice.paintId === paintId)?.price ?? 0;
    label.textContent = strings.t('hq.garage.paintLabel', { paint: nameOf(paintId) });
    apply.hidden = paintId === current;
    apply.textContent =
      paintId === null
        ? strings.t('hq.garage.paintFactory')
        : price === 0
          ? strings.t('hq.garage.paintPremium')
          : strings.t('hq.garage.paintNow', { price: strings.money(price) });
    apply.disabled = !state.canAfford(price);
  };
  const swatch = (paintId: string | null, color: number, price: number, lockedAt: number | null, premium = false): void => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = premium ? 'paint-picker__swatch is-premium' : 'paint-picker__swatch';
    node.dataset.paintId = paintId ?? 'factory';
    node.style.setProperty('--rh-swatch', `#${color.toString(16).padStart(6, '0')}`);
    node.setAttribute('role', 'radio');
    node.classList.toggle('is-current', paintId === current);
    const priceText = price === 0 ? strings.t('hq.garage.free') : strings.money(price);
    node.setAttribute(
      'aria-label',
      lockedAt === null
        ? `${nameOf(paintId)} · ${priceText}`
        : `${nameOf(paintId)} · ${strings.t('hq.locked', { level: lockedAt })}`,
    );
    node.title = node.getAttribute('aria-label')!;
    if (lockedAt !== null) {
      node.disabled = true;
      node.classList.add('is-locked');
    } else {
      node.addEventListener('click', () => {
        pick(paintId);
        onPick?.(paintId);
      });
    }
    choices.push({ paintId, price, node });
    swatches.append(node);
  };

  /** A premium colour not bought yet: shown, and a tap on it opens the shop. */
  const forSale = (paintId: string, color: number): void => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'paint-picker__swatch is-premium is-for-sale';
    node.dataset.paintId = paintId;
    node.style.setProperty('--rh-swatch', `#${color.toString(16).padStart(6, '0')}`);
    node.setAttribute('aria-label', `${nameOf(paintId)} · ${strings.t('hq.garage.premium')}`);
    node.title = node.getAttribute('aria-label')!;
    node.addEventListener('click', () => onPremium?.());
    swatches.append(node);
  };

  swatch(null, truck.definition.factoryColor, 0, null);
  for (const offer of state.offers) {
    if (offer.premium && offer.locked) {
      forSale(offer.paint.id, offer.paint.color);
    } else {
      swatch(offer.paint.id, offer.paint.color, offer.paint.price, offer.locked ? offer.requiredCompanyLevel : null, offer.premium);
    }
  }
  root.append(label, swatches, apply);
  pick(current);
  return root;
}
