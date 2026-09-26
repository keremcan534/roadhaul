import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import type { OwnedTruck, TruckOffer } from '../../systems/vehicles/GarageService';
import { button, element } from '../dom';
import type { Strings } from '../i18n';
import { truckSilhouette } from './truckSilhouette';
import { previewButton } from './upgradeCards';

/** What the garage card of a model offers the player. */
export interface TruckCardState {
  readonly offer: TruckOffer;
  /**
   * The company's truck of this model the card is about, if it owns one:
   * the one driven, else one in the garage, else one out with a driver.
   */
  readonly owned: OwnedTruck | undefined;
  /** A contract is under way: trucks cannot be switched. */
  readonly busy: boolean;
  /** Whether the company has `price` credits. */
  readonly canAfford: (price: number) => boolean;
  /** This model is the one shown in the showroom. */
  readonly previewing: boolean;
  /** How many trucks the company has, and how many its garage holds. */
  readonly garage: { readonly count: number; readonly capacity: number };
}

export interface TruckCardActions {
  readonly onBuy: (definitionId: string) => void;
  readonly onSwitch: (instanceId: string) => void;
  /** Shows this model in the showroom (again: back to the truck being driven). */
  readonly onPreview: (definitionId: string) => void;
}

/**
 * A truck model in the garage (spec §15): a picture of it in its colours,
 * what it carries and costs, and whether the company drives it, owns it (and
 * how many, for the fleet), can buy it (another), or must level up first.
 * Any model but the one being driven can be shown in the showroom before it
 * is bought or driven.
 */
export function truckCard(document: Document, strings: Strings, state: TruckCardState, actions: TruckCardActions): HTMLElement {
  const { offer, owned } = state;
  const { definition } = offer;
  const active = owned?.active === true;
  const card = element(document, 'article', 'truck-card');
  card.dataset.vehicleId = definition.id;
  card.dataset.previewKey = `truck:${definition.id}`;
  card.classList.toggle('is-active', active);
  card.classList.toggle('is-locked', owned === undefined && offer.locked);
  card.classList.toggle('is-previewing', state.previewing);

  const top = element(document, 'div', 'truck-card__top');
  top.append(
    element(document, 'h3', 'truck-card__title', strings.vehicleName(definition.id)),
    element(document, 'span', `badge badge--${definition.vehicleClass}`, strings.t(`vehicleClass.${definition.vehicleClass}`)),
  );
  const picture = truckSilhouette(document, definition, owned?.paint?.color ?? definition.factoryColor);
  const body = element(document, 'p', 'truck-card__body', strings.t(`body.${definition.bodyType}`));
  const facts = element(document, 'dl', 'truck-card__facts');
  for (const [label, value] of truckFacts(strings, definition)) {
    const fact = element(document, 'div', 'truck-card__fact');
    fact.append(element(document, 'dt', '', label), element(document, 'dd', '', value));
    facts.append(fact);
  }

  const bottom = element(document, 'div', 'truck-card__bottom');
  if (!active) {
    bottom.append(previewButton(document, strings, 'preview-truck', state.previewing, () => actions.onPreview(definition.id)));
  }
  const room = state.garage.count < state.garage.capacity;
  if (active) {
    bottom.append(element(document, 'span', 'truck-card__status', strings.t('hq.garage.inUse')));
  } else if (owned !== undefined && owned.driverId === null) {
    const drive = button(document, 'button--primary truck-card__action', strings.t('hq.garage.drive'), 'switch-truck', () =>
      actions.onSwitch(owned.instanceId),
    );
    drive.disabled = state.busy;
    bottom.append(drive);
    if (state.busy) {
      bottom.append(element(document, 'span', 'truck-card__status', strings.t('hq.garage.busy')));
    }
  } else if (owned !== undefined) {
    bottom.append(element(document, 'span', 'truck-card__status', strings.t('hq.garage.allOut')));
  } else if (offer.locked) {
    bottom.append(element(document, 'span', 'truck-card__price', strings.money(offer.price)));
    bottom.append(element(document, 'span', 'truck-card__status', strings.t('hq.locked', { level: offer.requiredCompanyLevel })));
  } else {
    const buy = button(
      document,
      'button--primary truck-card__action',
      strings.t('hq.garage.buy', { price: strings.money(offer.price) }),
      'buy-truck',
      () => actions.onBuy(definition.id),
    );
    buy.disabled = !room || !state.canAfford(offer.price);
    bottom.append(buy);
  }
  card.append(top, picture, body, facts, bottom);
  // One more for the fleet, while the garage has room.
  if (owned !== undefined) {
    const more = element(document, 'div', 'truck-card__more');
    more.append(element(document, 'span', 'truck-card__owned', strings.t('hq.garage.owned', { count: offer.ownedCount })));
    if (room) {
      const another = button(
        document,
        'button--secondary truck-card__action',
        strings.t('hq.garage.buyAnother', { price: strings.money(offer.price) }),
        'buy-another-truck',
        () => actions.onBuy(definition.id),
      );
      another.disabled = !state.canAfford(offer.price);
      more.append(another);
    } else {
      more.append(
        element(
          document,
          'span',
          'truck-card__full',
          strings.t('hq.garage.full', { count: state.garage.count, capacity: state.garage.capacity }),
        ),
      );
    }
    card.append(more);
  }
  return card;
}

/** Payload, tank and top speed. */
function truckFacts(strings: Strings, definition: VehicleDefinition): readonly (readonly [string, string])[] {
  return [
    [strings.t('hq.garage.payload'), strings.tons(definition.maxPayloadTons)],
    [strings.t('hq.garage.tank'), strings.t('format.liters', { value: strings.number(definition.fuelCapacityLiters) })],
    [strings.t('hq.garage.topSpeed'), strings.t('format.kmh', { value: strings.number(definition.maxSpeedKmh) })],
  ];
}
