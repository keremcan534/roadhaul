import type { DeliveryCondition, EventObjective, EventReward } from '../../data/definitions/EventDefinition';
import type { EventStatus } from '../../systems/events/EventService';
import type { Strings } from '../i18n';

/*
 * How the special events read, for the HQ's cards, the result and notices:
 * text only, no DOM.
 */

/**
 * The events tab's order: running events the company takes part in first,
 * soonest to end; then running ones it may not join yet; then the ones to
 * come, soonest to start; the ones over last.
 */
export function sortEvents(statuses: readonly EventStatus[]): EventStatus[] {
  const rank = (status: EventStatus): number =>
    status.running ? (status.locked ? 1 : 0) : status.run !== null ? 2 : 3;
  return [...statuses].sort((a, b) => rank(a) - rank(b) || a.remainingMs - b.remainingMs);
}

/** Which deliveries count: "Deliver with 25% of the time to spare · Loads of 8 t or more". */
export function conditionText(strings: Strings, condition: DeliveryCondition): string {
  const terms: string[] = [];
  if (condition.minTimeLeft !== undefined) {
    terms.push(
      condition.minTimeLeft > 0
        ? strings.t('event.condition.timeLeft', { percent: strings.percent(condition.minTimeLeft) })
        : strings.t('event.condition.onTime'),
    );
  }
  if (condition.maxCargoDamage !== undefined) {
    terms.push(
      condition.maxCargoDamage > 0
        ? strings.t('event.condition.maxDamage', { percent: strings.percent(condition.maxCargoDamage) })
        : strings.t('event.condition.noDamage'),
    );
  }
  if (condition.minCargoWeightTons !== undefined) {
    terms.push(strings.t('event.condition.minWeight', { tons: strings.tons(condition.minCargoWeightTons) }));
  }
  if (condition.cargoCategories !== undefined) {
    const categories = condition.cargoCategories.map((category) => strings.t(`cargoCategory.${category}`)).join(', ');
    terms.push(strings.t('event.condition.categories', { categories }));
  }
  return terms.length > 0 ? terms.join(' · ') : strings.t('event.condition.any');
}

/** "2 / 3 deliveries", "4,200 / 15,000 credits earned". */
export function objectiveText(strings: Strings, objective: EventObjective, progress: number): string {
  return objective.kind === 'deliveries'
    ? strings.t('event.objective.deliveries', { progress, target: objective.target })
    : strings.t('event.objective.credits', { progress: strings.number(progress), target: strings.money(objective.target) });
}

/** "Reward: 3,000 credits and 300 XP". */
export function rewardText(strings: Strings, reward: EventReward): string {
  return strings.t('event.reward', { credits: strings.money(reward.credits), xp: strings.number(reward.xp) });
}
