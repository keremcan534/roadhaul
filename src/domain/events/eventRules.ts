import type { CargoCategory } from '../../data/definitions/CargoDefinition';
import type { DeliveryCondition, EventObjective } from '../../data/definitions/EventDefinition';
import type { Credits, Fraction } from '../../data/units';

/** What a finished delivery was like, as far as events care. */
export interface DeliveryFacts {
  readonly onTime: boolean;
  /** Share of the time limit left at delivery; negative when late. */
  readonly timeLeft: Fraction;
  readonly cargoDamage: Fraction;
  readonly cargoWeightTons: number;
  readonly cargoCategory: CargoCategory;
  /** What the delivery paid, its bonuses and penalties included. */
  readonly pay: Credits;
}

/** Whether `delivery` meets every term of `condition`. */
export function deliveryQualifies(condition: DeliveryCondition, delivery: DeliveryFacts): boolean {
  const { minTimeLeft } = condition;
  // "Just on time" (0) is the reward's on time, grace second included.
  if (minTimeLeft !== undefined && (!delivery.onTime || (minTimeLeft > 0 && delivery.timeLeft < minTimeLeft))) {
    return false;
  }
  if (condition.maxCargoDamage !== undefined && delivery.cargoDamage > condition.maxCargoDamage) {
    return false;
  }
  return cargoMeets(condition, delivery.cargoWeightTons, delivery.cargoCategory);
}

/**
 * Whether a contract's cargo alone decides that it counts: `condition` has
 * terms on the cargo, and the cargo meets them. The job board marks such
 * contracts; conditions on how the delivery goes (time, damage) cannot be
 * known in advance.
 */
export function cargoQualifies(condition: DeliveryCondition, cargoWeightTons: number, cargoCategory: CargoCategory): boolean {
  const hasCargoTerms = condition.minCargoWeightTons !== undefined || condition.cargoCategories !== undefined;
  return hasCargoTerms && cargoMeets(condition, cargoWeightTons, cargoCategory);
}

/** The event's extra pay on a qualifying delivery that paid `pay`, whole credits. */
export function eventBonus(payBonus: Fraction, pay: Credits): Credits {
  return Math.round(pay * payBonus);
}

/** How far a qualifying delivery takes `objective`: one delivery, or the credits it earned (`paid`, bonus included). */
export function objectiveStep(objective: EventObjective, paid: Credits): number {
  return objective.kind === 'deliveries' ? 1 : paid;
}

function cargoMeets(condition: DeliveryCondition, cargoWeightTons: number, cargoCategory: CargoCategory): boolean {
  if (condition.minCargoWeightTons !== undefined && cargoWeightTons < condition.minCargoWeightTons) {
    return false;
  }
  return condition.cargoCategories === undefined || condition.cargoCategories.includes(cargoCategory);
}
