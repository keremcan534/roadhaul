import type { Credits } from '../../data/units';
import type { OwnedTruck } from '../../systems/vehicles/GarageService';
import type { UsedTruckOffer } from '../../systems/vehicles/UsedTruckMarket';
import { button, element } from '../dom';
import type { Strings } from '../i18n';
import { truckSilhouette } from './truckSilhouette';

/** What the used-truck cards need besides the offers. */
export interface UsedTrucksView {
  readonly offers: readonly UsedTruckOffer[];
  /** Milliseconds until the next list. */
  readonly nextListInMs: number;
  readonly canAfford: (price: Credits) => boolean;
  /** The garage has room for another truck. */
  readonly hasRoom: boolean;
  /** The colour a paint id stands for (the paint shop's), for the picture. */
  readonly colorOf: (paintId: string | null, factoryColor: number) => number;
}

/**
 * The used-truck market: when the next trucks come, and a card for each
 * truck for sale: its picture in its colour, its model, condition, how far
 * it has been driven and any upgrade fitted, its price against new, and a
 * button to buy it (or that it is sold).
 */
export function usedTruckCards(document: Document, strings: Strings, view: UsedTrucksView, onBuy: (index: number) => void): HTMLElement[] {
  const note = element(document, 'p', 'hq__note', strings.t('hq.used.note', { time: strings.timeSpan(view.nextListInMs) }));
  const cards = element(document, 'div', 'hq__cards');
  for (const offer of view.offers) {
    const { definition } = offer;
    const card = element(document, 'article', 'truck-card used-truck');
    card.dataset.usedIndex = String(offer.index);
    card.classList.toggle('is-sold', offer.sold);
    const top = element(document, 'div', 'truck-card__top');
    top.append(
      element(document, 'h3', 'truck-card__title', strings.vehicleName(definition.id)),
      element(document, 'span', 'badge used-truck__badge', strings.t('hq.used.badge')),
    );
    const facts = element(document, 'dl', 'truck-card__facts');
    const upgrades = Object.keys(offer.upgrades).map((id) => strings.upgradeName(id));
    for (const [label, value] of [
      [strings.t('hq.used.condition'), strings.percent(1 - offer.damage)],
      [strings.t('hq.used.odometer'), strings.t('format.kilometers', { value: strings.number(offer.odometerKm) })],
      [strings.t('hq.used.upgrades'), upgrades.length === 0 ? strings.t('hq.used.noUpgrades') : upgrades.join(', ')],
    ] as const) {
      const fact = element(document, 'div', 'truck-card__fact');
      fact.append(element(document, 'dt', '', label), element(document, 'dd', '', value));
      facts.append(fact);
    }
    const bottom = element(document, 'div', 'truck-card__bottom');
    const prices = element(document, 'span', 'used-truck__prices');
    const saving = Math.round((1 - offer.price / offer.newPrice) * 100) / 100;
    prices.append(
      element(document, 'span', 'used-truck__new', strings.money(offer.newPrice)),
      element(document, 'span', 'used-truck__saving', `−${strings.percent(saving)}`),
    );
    bottom.append(prices);
    if (offer.sold) {
      bottom.append(element(document, 'span', 'truck-card__status', strings.t('hq.used.sold')));
    } else {
      const buy = button(
        document,
        'button--primary truck-card__action',
        strings.t('hq.garage.buy', { price: strings.money(offer.price) }),
        'buy-used-truck',
        () => onBuy(offer.index),
      );
      buy.disabled = !view.hasRoom || !view.canAfford(offer.price);
      bottom.append(buy);
    }
    card.append(
      top,
      truckSilhouette(document, definition, view.colorOf(offer.paintId, definition.factoryColor)),
      facts,
      bottom,
    );
    cards.append(card);
  }
  return [note, cards];
}

/** What the list of the company's own trucks needs. */
export interface OwnedTrucksView {
  readonly trucks: readonly OwnedTruck[];
  /** What each would fetch sold. */
  readonly saleValue: (instanceId: string) => Credits;
  /** The name of the hired driver who has a truck out. */
  readonly driverName: (driverId: string) => string;
}

/**
 * The company's trucks one by one: each one's model and number, its
 * condition, where it is (driven, in the garage, out with a driver), and a
 * way to sell it: a first tap asks, a second sells. The one driven and those
 * out cannot be sold.
 */
export function ownedTruckRows(document: Document, strings: Strings, view: OwnedTrucksView, onSell: (instanceId: string) => void): HTMLElement {
  const list = element(document, 'ul', 'owned-trucks');
  view.trucks.forEach((truck, order) => {
    const row = element(document, 'li', 'owned-trucks__row');
    row.dataset.instanceId = truck.instanceId;
    const name = element(document, 'span', 'owned-trucks__name', `${strings.vehicleName(truck.definition.id)} #${order + 1}`);
    const status = truck.active
      ? strings.t('hq.garage.inUse')
      : truck.driverId !== null
        ? strings.t('hq.used.withDriver', { driver: view.driverName(truck.driverId) })
        : strings.t('hq.used.inGarage');
    const details = element(document, 'span', 'owned-trucks__details', `${strings.t('hq.used.condition')} ${strings.percent(1 - truck.damage)} · ${status}`);
    const text = element(document, 'span', 'owned-trucks__text');
    text.append(name, details);
    row.append(text);
    if (!truck.active && truck.driverId === null) {
      const price = strings.money(view.saleValue(truck.instanceId));
      const sell = button(document, 'button--secondary owned-trucks__sell', strings.t('hq.used.sell', { price }), 'sell-truck', () => {
        // A first tap asks; the second sells.
        if (sell.dataset.confirm !== 'true') {
          sell.dataset.confirm = 'true';
          sell.textContent = strings.t('hq.used.sellSure', { price });
          sell.classList.replace('button--secondary', 'button--danger');
          return;
        }
        onSell(truck.instanceId);
      });
      row.append(sell);
    }
    list.append(row);
  });
  return list;
}
