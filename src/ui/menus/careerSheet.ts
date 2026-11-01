import type { Credits } from '../../data/units';
import type { CareerRecords } from '../../systems/company/CareerService';
import { element } from '../dom';
import type { Strings } from '../i18n';
import { icon } from '../icons';
import type { IconName } from '../iconShapes';

/** The career as the career page shows it: CareerService's records, and what the company and its goals count. */
export interface CareerShown {
  readonly records: CareerRecords;
  readonly distanceMeters: number;
  readonly deliveries: number;
  readonly failed: number;
  readonly earned: Credits;
  readonly perfect: number;
  readonly bestStreak: number;
  readonly tendersWon: number;
  readonly cratesOpened: number;
  readonly skyWonders: number;
}

/** One figure: its picture, its name (`career.<stat>`) and its value, written out. */
type Figure = readonly [stat: string, picture: IconName, value: string];

/**
 * The career page (the goals dialog's second tab): the company's record in
 * groups of figures, on the road, its deliveries, its money, its mishaps,
 * its favourites; each a tile with its picture, its value large and its name.
 */
export function careerSheet(document: Document, strings: Strings, shown: CareerShown): HTMLElement {
  const { records } = shown;
  const count = (value: number): string => strings.number(value);
  // Far, in whole kilometres: "1,234 km", not "1,234.5 km".
  const distance = (meters: number): string =>
    meters >= 100_000 ? strings.t('format.kilometers', { value: strings.number(Math.round(meters / 1000)) }) : strings.distance(meters);
  const favourite = (id: string | null, name: (id: string) => string, times: number): string =>
    id === null ? strings.t('career.none') : `${name(id)} · ${strings.t('career.timesDelivered', { count: strings.number(times) })}`;
  const groups: readonly (readonly [group: string, figures: readonly Figure[]])[] = [
    [
      'road',
      [
        ['distance', 'route', distance(shown.distanceMeters)],
        ['drivingTime', 'clock', strings.timeSpan(records.drivingSeconds * 1000)],
        ['topSpeed', 'express', strings.t('format.kmh', { value: strings.number(Math.floor(records.topSpeedKmh)) })],
        ['longestHaul', 'pin', distance(records.longestHaulMeters)],
      ],
    ],
    [
      'deliveries',
      [
        ['deliveries', 'jobs', count(shown.deliveries)],
        ['perfect', 'careful', count(shown.perfect)],
        ['bestStreak', 'star', count(shown.bestStreak)],
        ['tons', 'heavy', strings.tons(Math.round(records.tonsDelivered * 10) / 10)],
        ['bestPay', 'coins', strings.money(records.bestPay)],
        ['tendersWon', 'rivals', count(shown.tendersWon)],
        ['fleetDeliveries', 'fleet', count(records.fleetDeliveries)],
        ['failed', 'flag', count(shown.failed)],
      ],
    ],
    [
      'money',
      [
        ['earned', 'coins', strings.money(shown.earned)],
        ['fuel', 'fuel', strings.t('format.liters', { value: strings.number(Math.round(records.fuelLiters)) })],
        ['fuelSpent', 'fuel', strings.money(records.fuelSpent)],
        ['repairs', 'wrench', strings.money(records.repairsSpent)],
      ],
    ],
    [
      'mishaps',
      [
        ['knocks', 'wrench', count(records.knocks)],
        ['overturns', 'truck', count(records.overturns)],
        ['carsWrecked', 'close', count(records.carsWrecked)],
        ['propsKnocked', 'pin', count(records.propsKnocked)],
      ],
    ],
    [
      'favourites',
      [
        ['favouriteCargo', 'cargo', favourite(records.favouriteCargoId, (id) => strings.cargoName(id), records.cargo[records.favouriteCargoId ?? ''] ?? 0)],
        ['favouriteCity', 'flag', favourite(records.favouriteCityId, (id) => strings.cityName(id), records.destinations[records.favouriteCityId ?? ''] ?? 0)],
        ['cratesOpened', 'crate', count(shown.cratesOpened)],
        ['skyWonders', 'eye', count(shown.skyWonders)],
      ],
    ],
  ];
  const sheet = element(document, 'div', 'career');
  for (const [group, figures] of groups) {
    const section = element(document, 'section', `career__group career__group--${group}`);
    const grid = element(document, 'div', 'career__grid');
    for (const [stat, picture, value] of figures) {
      const tile = element(document, 'div', 'career__tile');
      tile.dataset.stat = stat;
      tile.append(
        icon(document, picture, 'career__icon'),
        element(document, 'span', 'career__value', value),
        element(document, 'span', 'career__label', strings.t(`career.${stat}`)),
      );
      grid.append(tile);
    }
    section.append(element(document, 'h3', 'rh-label career__title', strings.t(`career.group.${group}`)), grid);
    sheet.append(section);
  }
  return sheet;
}
