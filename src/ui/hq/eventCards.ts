import type { DeliveryCondition } from '../../data/definitions/EventDefinition';
import type { EventStatus } from '../../systems/events/EventService';
import { element } from '../dom';
import type { Strings } from '../i18n';
import { icon, type IconName } from '../icons';
import { conditionText, objectiveText, rewardText } from './eventText';

/**
 * A special event on the company panel's events page (spec §22): a picture
 * of what it rewards, what it asks, which deliveries count and their bonus,
 * how far along the company is, the reward, and when it ends or starts.
 */
export function eventCard(document: Document, strings: Strings, status: EventStatus): HTMLElement {
  const { definition, running, locked, completed, progress } = status;
  const state = completed ? 'completed' : running ? 'running' : status.run === null ? 'over' : 'upcoming';
  const card = element(document, 'article', `event-card is-${state}${locked ? ' is-locked' : ''}`);
  card.dataset.eventId = definition.id;
  card.dataset.state = state;

  const top = element(document, 'div', 'event-card__top');
  const picture = element(document, 'span', 'event-card__icon');
  picture.append(icon(document, eventIcon(definition.qualifyingDelivery)));
  top.append(
    picture,
    element(document, 'h3', 'event-card__title', strings.eventName(definition.id)),
    element(document, 'span', 'event-card__when', whenText(strings, status)),
  );
  const terms = element(document, 'p', 'event-card__terms', conditionText(strings, definition.qualifyingDelivery));
  const bonus = element(
    document,
    'p',
    'event-card__bonus',
    strings.t('event.bonus', { percent: strings.percent(definition.payBonus) }),
  );
  const objective = element(document, 'p', 'event-card__objective', objectiveText(strings, definition.objective, progress));
  const meter = element(document, 'div', 'meter meter--event');
  const fill = element(document, 'div', 'meter__fill');
  fill.style.transform = `scaleX(${Math.min(1, progress / definition.objective.target)})`;
  meter.append(fill);
  const bottom = element(document, 'div', 'event-card__bottom');
  const reward = element(document, 'span', 'event-card__reward');
  reward.append(icon(document, 'trophy'), element(document, 'span', '', rewardText(strings, definition.reward)));
  bottom.append(reward);
  const note = statusNote(strings, status);
  if (note !== null) {
    bottom.append(element(document, 'span', 'event-card__status', note));
  }
  card.append(
    top,
    element(document, 'p', 'event-card__description', strings.t(`event.${definition.id}.description`)),
    terms,
    bonus,
    objective,
    meter,
    bottom,
  );
  return card;
}

function whenText(strings: Strings, status: EventStatus): string {
  if (status.run === null) {
    return strings.t('event.over');
  }
  const time = strings.timeSpan(status.remainingMs);
  return status.running ? strings.t('event.endsIn', { time }) : strings.t('event.startsIn', { time });
}

function statusNote(strings: Strings, status: EventStatus): string | null {
  if (status.locked) {
    return strings.t('hq.locked', { level: status.definition.requiredCompanyLevel ?? 1 });
  }
  return status.completed ? strings.t('event.completed') : null;
}

/** What an event rewards, as a picture: fast deliveries, careful ones, heavy loads, or any delivery. */
function eventIcon(condition: DeliveryCondition): IconName {
  if (condition.minTimeLeft !== undefined) {
    return 'express';
  }
  if (condition.maxCargoDamage !== undefined) {
    return 'careful';
  }
  if (condition.minCargoWeightTons !== undefined) {
    return 'heavy';
  }
  return 'events';
}
