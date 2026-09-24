import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import type { OwnedTruck, PaintOffer, TruckOffer } from '../../systems/vehicles/GarageService';
import { button, element } from '../dom';
import type { Strings } from '../i18n';
import { paintPicker } from './paintPicker';

/** What the garage card of a model offers the player. */
export interface TruckCardState {
  readonly offer: TruckOffer;
  /** The company's truck of this model, if it owns one. */
  readonly owned: OwnedTruck | undefined;
  /** A contract is under way: trucks cannot be switched. */
  readonly busy: boolean;
  /** Whether the company has `price` credits (the truck, or a paint). */
  readonly canAfford: (price: number) => boolean;
  /** The paint shop's colours, for the truck the company owns. */
  readonly paints: readonly PaintOffer[];
}

export interface TruckCardActions {
  readonly onBuy: (definitionId: string) => void;
  readonly onSwitch: (instanceId: string) => void;
  readonly onPaint: (instanceId: string, paintId: string | null) => void;
}

/**
 * A truck model in the garage (spec §15): what it carries and costs, and
 * whether the company drives it, owns it, can buy it, or must level up first.
 * A truck the company owns can be painted here (paintPicker).
 */
export function truckCard(document: Document, strings: Strings, state: TruckCardState, actions: TruckCardActions): HTMLElement {
  const { offer, owned } = state;
  const { definition } = offer;
  const card = element(document, 'article', 'truck-card');
  card.dataset.vehicleId = definition.id;
  card.classList.toggle('is-active', owned?.active === true);
  card.classList.toggle('is-locked', owned === undefined && offer.locked);

  const top = element(document, 'div', 'truck-card__top');
  top.append(
    element(document, 'h3', 'truck-card__title', strings.vehicleName(definition.id)),
    element(document, 'span', `badge badge--${definition.vehicleClass}`, strings.t(`vehicleClass.${definition.vehicleClass}`)),
  );
  const body = element(document, 'p', 'truck-card__body', strings.t(`body.${definition.bodyType}`));
  const facts = element(document, 'dl', 'truck-card__facts');
  for (const [label, value] of truckFacts(strings, definition)) {
    const fact = element(document, 'div', 'truck-card__fact');
    fact.append(element(document, 'dt', '', label), element(document, 'dd', '', value));
    facts.append(fact);
  }

  const bottom = element(document, 'div', 'truck-card__bottom');
  if (owned?.active === true) {
    bottom.append(element(document, 'span', 'truck-card__status', strings.t('hq.garage.inUse')));
  } else if (owned !== undefined) {
    const drive = button(document, 'button--primary truck-card__action', strings.t('hq.garage.drive'), 'switch-truck', () =>
      actions.onSwitch(owned.instanceId),
    );
    drive.disabled = state.busy;
    bottom.append(drive);
    if (state.busy) {
      bottom.append(element(document, 'span', 'truck-card__status', strings.t('hq.garage.busy')));
    }
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
    buy.disabled = !state.canAfford(offer.price);
    bottom.append(buy);
  }
  card.append(top, body, facts, bottom);
  if (owned !== undefined) {
    card.append(paintPicker(document, strings, { truck: owned, offers: state.paints, canAfford: state.canAfford }, actions.onPaint));
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
