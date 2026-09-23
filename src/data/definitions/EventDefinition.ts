import type { Validator } from '../../core/validation/Validator';
import type { Credits, Fraction } from '../units';
import { CARGO_CATEGORIES, type CargoCategory } from './CargoDefinition';

/** What an event asks for (spec §22 objectives): a number of qualifying deliveries, or credits earned with them. */
export const EVENT_OBJECTIVE_KINDS = ['deliveries', 'credits'] as const;
export type EventObjectiveKind = (typeof EVENT_OBJECTIVE_KINDS)[number];

/**
 * A timed event (spec §22–23, §53, §78): while it runs, deliveries that meet
 * its conditions pay a bonus and count toward its objective, and meeting the
 * objective earns its reward once per run. Events reuse the contracts on the
 * job board; they need no code of their own.
 */
export interface EventDefinition {
  /** Stable snake_case id. It is written into save files: never rename it. */
  readonly id: string;
  readonly schedule: EventSchedule;
  /** The company level that lets the company take part (spec: requirements). Omit for level 1. */
  readonly requiredCompanyLevel?: number;
  /** The deliveries that count and earn the bonus: every condition given must hold. */
  readonly qualifyingDelivery: DeliveryCondition;
  readonly objective: EventObjective;
  /** Paid once per run, when the objective is met. */
  readonly reward: EventReward;
  /** Spec: modifiers. Extra pay on each qualifying delivery while the event runs, as a share of its pay. */
  readonly payBonus: Fraction;
}

/** When an event runs, in whole days from midnight UTC. */
export interface EventSchedule {
  /** The first day of the first run, 'YYYY-MM-DD'. */
  readonly startDate: string;
  readonly durationDays: number;
  /** Each run starts this many days after the one before; omit for a one-off. */
  readonly repeatEveryDays?: number;
}

export interface DeliveryCondition {
  /** Delivered on time, with at least this share of the time limit left (0: just on time). */
  readonly minTimeLeft?: Fraction;
  /** The cargo arrives with at most this much damage (0: none at all). */
  readonly maxCargoDamage?: Fraction;
  readonly minCargoWeightTons?: number;
  readonly cargoCategories?: readonly CargoCategory[];
}

export interface EventObjective {
  readonly kind: EventObjectiveKind;
  /** Qualifying deliveries, or credits paid for them (bonus included). */
  readonly target: number;
}

export interface EventReward {
  readonly credits: Credits;
  readonly xp: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Midnight UTC starting `date` ('YYYY-MM-DD'), epoch ms; NaN when it is not a real date. */
export function utcMidnightMs(date: string): number {
  if (!ISO_DATE.test(date)) {
    return Number.NaN;
  }
  const ms = Date.parse(`${date}T00:00:00Z`);
  // Date.parse rolls impossible dates such as 2026-02-30 over; a real date survives the round trip.
  return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(date) ? ms : Number.NaN;
}

export function validateEventDefinition(event: EventDefinition, path: string, validator: Validator): void {
  validator.id(event.id, `${path}.id`);
  const schedule = event.schedule;
  if (validator.check(typeof schedule === 'object' && schedule !== null, `${path}.schedule`, 'must be an object')) {
    validator.check(
      typeof schedule.startDate === 'string' && Number.isFinite(utcMidnightMs(schedule.startDate)),
      `${path}.schedule.startDate`,
      'must be a real date, YYYY-MM-DD',
    );
    validator.positiveInteger(schedule.durationDays, `${path}.schedule.durationDays`);
    if (schedule.repeatEveryDays !== undefined) {
      validator.check(
        Number.isInteger(schedule.repeatEveryDays) && schedule.repeatEveryDays >= schedule.durationDays,
        `${path}.schedule.repeatEveryDays`,
        'must be a whole number of days, at least durationDays',
      );
    }
  }
  if (event.requiredCompanyLevel !== undefined) {
    validator.positiveInteger(event.requiredCompanyLevel, `${path}.requiredCompanyLevel`);
  }
  const condition = event.qualifyingDelivery;
  if (validator.check(typeof condition === 'object' && condition !== null, `${path}.qualifyingDelivery`, 'must be an object')) {
    if (condition.minTimeLeft !== undefined) {
      validator.fraction(condition.minTimeLeft, `${path}.qualifyingDelivery.minTimeLeft`);
    }
    if (condition.maxCargoDamage !== undefined) {
      validator.fraction(condition.maxCargoDamage, `${path}.qualifyingDelivery.maxCargoDamage`);
    }
    if (condition.minCargoWeightTons !== undefined) {
      validator.positiveNumber(condition.minCargoWeightTons, `${path}.qualifyingDelivery.minCargoWeightTons`);
    }
    if (condition.cargoCategories !== undefined) {
      const categories = condition.cargoCategories;
      if (
        validator.check(
          Array.isArray(categories) && categories.length > 0,
          `${path}.qualifyingDelivery.cargoCategories`,
          'must list at least one cargo category',
        )
      ) {
        categories.forEach((category, index) =>
          validator.oneOf(category, CARGO_CATEGORIES, `${path}.qualifyingDelivery.cargoCategories[${index}]`),
        );
      }
    }
  }
  const objective = event.objective;
  if (validator.check(typeof objective === 'object' && objective !== null, `${path}.objective`, 'must be an object')) {
    validator.oneOf(objective.kind, EVENT_OBJECTIVE_KINDS, `${path}.objective.kind`);
    validator.positiveInteger(objective.target, `${path}.objective.target`);
  }
  const reward = event.reward;
  if (validator.check(typeof reward === 'object' && reward !== null, `${path}.reward`, 'must be an object')) {
    validator.nonNegativeInteger(reward.credits, `${path}.reward.credits`);
    validator.nonNegativeInteger(reward.xp, `${path}.reward.xp`);
  }
  validator.fraction(event.payBonus, `${path}.payBonus`);
}
