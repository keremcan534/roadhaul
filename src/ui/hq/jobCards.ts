import type { MissionDefinition } from '../../data/definitions/MissionDefinition';
import type { JobOffer } from '../../systems/missions/MissionService';
import { button, element } from '../dom';
import type { Strings } from '../i18n';

/** A contract on the job board (spec §28): route, cargo, distance, time and pay; what blocks it, or the button to take it. */
export function jobCard(document: Document, strings: Strings, offer: JobOffer, onAccept: (missionId: string) => void): HTMLElement {
  const { mission, cargo } = offer;
  const card = element(document, 'article', offer.blockedBy === null ? 'job-card' : 'job-card is-locked');
  card.dataset.missionId = mission.id;

  const top = element(document, 'div', 'job-card__top');
  top.append(
    element(document, 'h3', 'job-card__title', strings.missionTitle(mission.id)),
    element(document, 'span', `badge badge--${mission.difficulty}`, strings.t(`difficulty.${mission.difficulty}`)),
  );
  const route = element(document, 'p', 'job-card__route', routeText(strings, mission));
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
  const bottom = element(document, 'div', 'job-card__bottom');
  bottom.append(element(document, 'span', 'job-card__pay', strings.money(offer.basePay)));
  if (offer.blockedBy !== null) {
    bottom.append(element(document, 'span', 'job-card__locked', blockerText(strings, offer)));
  } else {
    bottom.append(
      button(document, 'button--primary job-card__accept', strings.t('hq.accept'), 'accept', () => onAccept(mission.id)),
    );
  }
  card.append(top, route, load, facts, bottom);
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

/** "Yeniliman → Demirkent". */
export function routeText(strings: Strings, mission: MissionDefinition): string {
  return `${strings.cityName(mission.originCityId)} → ${strings.cityName(mission.destinationCityId)}`;
}
