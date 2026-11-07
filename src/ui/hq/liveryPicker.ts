import type { LiveryDefinition, LiveryPattern } from '../../data/definitions/LiveryDefinition';
import type { LiveryOffer } from '../../systems/vehicles/LiveryService';
import { button, element } from '../dom';
import type { Strings } from '../i18n';
import { withIcon } from '../icons';

/** What the design picker needs to know. */
export interface LiveryPickerState {
  readonly offers: readonly LiveryOffer[];
  /** The design the truck being driven wears. */
  readonly worn: LiveryDefinition;
  /** The company's trailer text, or null for RoadHaul. */
  readonly text: string | null;
  readonly canAfford: (price: number) => boolean;
  /** A design's small picture in the truck's colour, as an image URL. */
  readonly picture: (pattern: LiveryPattern) => string;
}

export interface LiveryPickerActions {
  readonly onBuy: (liveryId: string) => void;
  readonly onApply: (liveryId: string) => void;
  /** Shows a design on the truck while the panel is open. */
  readonly onPreview: (liveryId: string) => void;
  readonly onSetText: (text: string) => void;
  /** Opens the shop, where the packs are sold. */
  readonly onOpenShop: () => void;
}

/** The most letters the text field takes (LiveryService trims to what can be lettered). */
const TEXT_FIELD_MAX = 20;

/**
 * The trucks' designs, in the garage: the company's trailer text (typed,
 * then lettered on every trailer), and a card for each design with its
 * picture in the truck's colour. A tap on a picture shows it on the truck;
 * a design the company has goes on the truck being driven for free, one
 * sold for credits is bought once for every truck, and a crate's or a
 * pack's says where it comes from (a pack's opens the shop).
 */
export function liveryPicker(
  document: Document,
  strings: Strings,
  state: LiveryPickerState,
  actions: LiveryPickerActions,
): HTMLElement {
  const root = element(document, 'div', 'livery-picker');

  const textRow = element(document, 'form', 'livery-picker__text');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'livery-picker__input';
  input.maxLength = TEXT_FIELD_MAX;
  input.value = state.text ?? '';
  input.placeholder = 'ROADHAUL';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', strings.t('hq.livery.text'));
  input.dataset.value = 'trailer-text';
  const write = button(document, 'button--secondary livery-picker__write', strings.t('hq.livery.write'), 'set-trailer-text', () =>
    actions.onSetText(input.value),
  );
  write.type = 'submit';
  textRow.addEventListener('submit', (event) => {
    event.preventDefault();
  });
  textRow.append(element(document, 'span', 'livery-picker__label', strings.t('hq.livery.text')), input, write);

  const cards = element(document, 'div', 'livery-picker__cards');
  for (const offer of state.offers) {
    const { livery } = offer;
    const card = element(document, 'div', 'livery-card');
    card.dataset.livery = livery.id;
    card.dataset.way = offer.way;
    const worn = livery.id === state.worn.id;
    card.classList.toggle('is-worn', worn);
    card.classList.toggle('is-owned', offer.owned);
    const picture = document.createElement('button');
    picture.type = 'button';
    picture.className = 'livery-card__picture';
    picture.dataset.action = 'preview-livery';
    picture.setAttribute('aria-label', strings.t(`livery.${livery.id}.name`));
    const image = document.createElement('img');
    image.alt = '';
    image.src = state.picture(livery.pattern);
    picture.append(image);
    picture.addEventListener('click', () => actions.onPreview(livery.id));
    const name = element(document, 'span', 'livery-card__name', strings.t(`livery.${livery.id}.name`));
    card.append(picture, name);
    if (livery.crate !== undefined) {
      card.dataset.rarity = livery.crate;
    }
    if (worn) {
      card.append(element(document, 'span', 'livery-card__status', strings.t('hq.livery.worn')));
    } else if (offer.owned) {
      card.append(
        button(document, 'button--primary livery-card__action', strings.t('hq.livery.apply'), 'apply-livery', () =>
          actions.onApply(livery.id),
        ),
      );
    } else if (offer.way === 'credits') {
      if (offer.locked) {
        const level = livery.requiredCompanyLevel ?? 1;
        card.append(element(document, 'span', 'livery-card__status', strings.t('hq.locked', { level })));
      } else {
        const buy = button(
          document,
          'button--secondary livery-card__action',
          strings.t('hq.livery.buy', { cost: strings.money(livery.price) }),
          'buy-livery',
          () => actions.onBuy(livery.id),
        );
        buy.disabled = !state.canAfford(livery.price);
        card.append(buy);
      }
    } else if (offer.way === 'crate') {
      const rarity = strings.t(`rarity.${livery.crate ?? 'rare'}`);
      card.append(element(document, 'span', 'livery-card__status', strings.t('hq.livery.fromCrate', { rarity })));
    } else if (offer.way === 'pack' && livery.pack !== undefined) {
      const pack = strings.t(`product.${livery.pack}.name`);
      if (offer.unavailable) {
        card.append(element(document, 'span', 'livery-card__status', strings.t('hq.livery.inPack', { pack })));
      } else {
        const shop = button(document, 'button--secondary livery-card__action', pack, 'livery-pack', actions.onOpenShop);
        card.append(withIcon(shop, 'truck'));
      }
    }
    cards.append(card);
  }
  root.append(textRow, cards);
  return root;
}
