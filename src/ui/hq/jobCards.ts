import type { EventDefinition } from '../../data/definitions/EventDefinition';
import type { MissionDefinition } from '../../data/definitions/MissionDefinition';
import type { Credits, Fraction } from '../../data/units';
import type { JobOffer } from '../../systems/missions/MissionService';
import { button, element } from '../dom';
import type { Strings } from '../i18n';
import { cargoIcon, icon } from '../icons';

/** What the rivals mean for a contract on the board. */
export interface JobRivalry {
  /** A tender: the rival racing for it (its name and colour, CSS), and the prize. */
  readonly tender: { readonly rival: string; readonly color: string; readonly prize: Credits } | null;
  /** The bonus it pays from a city the company leads. */
  readonly leaderBonus: Fraction | null;
}

const NO_RIVALRY: JobRivalry = { tender: null, leaderBonus: null };

/**
 * A contract on the job board (spec §28): its cargo's picture, route, cargo,
 * distance, time and pay; the running `events` it counts toward, with their
 * bonus; a tender's rival and prize, and the leader's bonus of the city it
 * leaves (`rivalry`); what blocks it, or the button to take it. While another
 * contract is `busy`, it says to finish that one first.
 */
export function jobCard(
  document: Document,
  strings: Strings,
  offer: JobOffer,
  onAccept: (missionId: string) => void,
  events: readonly EventDefinition[] = [],
  busy = false,
  rivalry: JobRivalry = NO_RIVALRY,
): HTMLElement {
  const { mission, cargo } = offer;
  const tender = rivalry.tender;
  const card = element(document, 'article', offer.blockedBy === null ? 'job-card' : 'job-card is-locked');
  // A tender is generated too, but it is not one of the contracts of the day.
  card.classList.toggle('job-card--daily', offer.daily && tender === null);
  card.classList.toggle('job-card--tender', tender !== null);
  card.dataset.missionId = mission.id;
  card.dataset.cargoCategory = cargo.category;

  const top = element(document, 'div', 'job-card__top');
  const picture = element(document, 'span', 'job-card__icon');
  picture.append(icon(document, cargoIcon(cargo.category)));
  const heading = element(document, 'div', 'job-card__heading');
  const badges = element(document, 'div', 'job-card__badges');
  if (tender !== null) {
    const badge = element(document, 'span', 'badge badge--tender');
    badge.append(icon(document, 'flag'), element(document, 'span', '', strings.t('hq.tender')));
    badges.append(badge);
  } else if (offer.daily) {
    badges.append(element(document, 'span', 'badge badge--daily', strings.t('hq.daily')));
  }
  badges.append(
    element(document, 'span', `badge badge--${mission.difficulty}`, strings.t(`difficulty.${mission.difficulty}`)),
  );
  heading.append(element(document, 'h3', 'job-card__title', strings.missionTitle(mission)), badges);
  top.append(picture, heading);
  const route = element(document, 'p', 'job-card__route');
  route.append(icon(document, 'route'), element(document, 'span', '', routeText(strings, mission)));
  const load = element(
    document,
    'p',
    'job-card__cargo',
    `${strings.cargoName(cargo.id)} · ${strings.tons(mission.cargoWeightTons)}`,
  );
  const facts = element(document, 'dl', 'job-card__facts');
  for (const [label, value] of [
    [strings.t('hq.distance'), strings.distance(offer.distanceMeters)],
    [strings.t('hq.timeLimit'), strings.duration(mission.timeLimitSeconds)],
  ] as const) {
    const fact = element(document, 'div', 'job-card__fact');
    fact.append(element(document, 'dt', '', label), element(document, 'dd', '', value));
    facts.append(fact);
  }
  const bonuses = events.map((event) =>
    element(
      document,
      'span',
      'job-card__event',
      strings.t('hq.eventBonus', { event: strings.eventName(event.id), percent: strings.percent(event.payBonus) }),
    ),
  );
  if (rivalry.leaderBonus !== null) {
    bonuses.push(
      element(document, 'span', 'job-card__event job-card__leader', strings.t('hq.leaderBonus', { percent: strings.percent(rivalry.leaderBonus) })),
    );
  }
  const bottom = element(document, 'div', 'job-card__bottom');
  bottom.append(element(document, 'span', 'job-card__pay', strings.money(offer.basePay)));
  if (offer.blockedBy !== null) {
    bottom.append(element(document, 'span', 'job-card__locked', blockerText(strings, offer)));
  } else if (busy) {
    bottom.append(element(document, 'span', 'job-card__locked', strings.t('hq.garage.busy')));
  } else {
    bottom.append(
      button(document, 'button--primary job-card__accept', strings.t('hq.accept'), 'accept', () => onAccept(mission.id)),
    );
  }
  card.append(top, route, load, facts);
  if (tender !== null) {
    const race = element(document, 'p', 'job-card__race');
    race.style.setProperty('--company-color', tender.color);
    race.append(
      element(document, 'span', 'company-swatch'),
      element(document, 'span', '', strings.t('hq.tenderRace', { company: tender.rival, prize: strings.money(tender.prize) })),
    );
    card.append(race);
  }
  if (bonuses.length > 0) {
    const row = element(document, 'div', 'job-card__events');
    row.append(...bonuses);
    card.append(row);
  }
  card.append(bottom);
  return card;
}

/** Why a contract cannot be taken yet: "Unlocks at level 3", "Needs the RoadHaul H2". */
export function blockerText(strings: Strings, offer: JobOffer): string {
  if (offer.blockedBy === 'companyLevel') {
    return strings.t('hq.locked', { level: offer.requiredCompanyLevel });
  }
  const trucks = offer.suitableVehicles.map((vehicle) => strings.vehicleName(vehicle.id)).join(' / ');
  return strings.t('hq.needsTruck', { trucks });
}

/** "Havenport → Ironford". */
export function routeText(strings: Strings, mission: MissionDefinition): string {
  return `${strings.cityName(mission.originCityId)} → ${strings.cityName(mission.destinationCityId)}`;
}
