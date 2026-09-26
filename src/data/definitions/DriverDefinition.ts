import type { Validator } from '../../core/validation/Validator';
import type { Credits, Fraction } from '../units';

/** A driver's skill, shown as stars: 1 a beginner, 5 the best on the roads. */
export const MAX_DRIVER_SKILL = 5;

/**
 * A driver the company can hire for its fleet (spec §27, V2: "Truck 2 → AI
 * Driver"; the spec's DriverDefinition: skill, salary, efficiency, risk). A
 * hired driver takes one of the company's other trucks on contracts between
 * the cities by themself, for a share of each one's pay. Better drivers are
 * quicker and safer, and ask a bigger share and a bigger fee. Their names
 * come from the string tables (`driver.<id>.name`).
 */
export interface DriverDefinition {
  /** Stable snake_case id. It is written into save files: never rename it. */
  readonly id: string;
  /** 1 to MAX_DRIVER_SKILL stars: what the player sees of the numbers below. */
  readonly skill: number;
  /** How much quicker than the fleet's average pace they drive: 1 is the average, 1.1 a tenth quicker. */
  readonly speedFactor: number;
  /** The chance a contract ends with the truck damaged (a scrape, a kerb, a pothole). */
  readonly incidentChance: Fraction;
  /** The share of each contract's pay the driver keeps: their wage (the spec's salary). */
  readonly payShare: Fraction;
  /** Paid once, when they join. */
  readonly hiringFee: Credits;
  /** The company level they join from (spec §14). Omit for level 1. */
  readonly requiredCompanyLevel?: number;
}

export function validateDriverDefinition(driver: DriverDefinition, path: string, validator: Validator): void {
  validator.id(driver.id, `${path}.id`);
  validator.check(
    Number.isInteger(driver.skill) && driver.skill >= 1 && driver.skill <= MAX_DRIVER_SKILL,
    `${path}.skill`,
    `must be a whole number from 1 to ${MAX_DRIVER_SKILL}`,
  );
  validator.check(
    Number.isFinite(driver.speedFactor) && driver.speedFactor >= 0.5 && driver.speedFactor <= 1.5,
    `${path}.speedFactor`,
    'must be from 0.5 to 1.5',
  );
  validator.fraction(driver.incidentChance, `${path}.incidentChance`);
  validator.check(
    Number.isFinite(driver.payShare) && driver.payShare > 0 && driver.payShare < 1,
    `${path}.payShare`,
    'must be more than 0 and less than 1',
  );
  validator.positiveInteger(driver.hiringFee, `${path}.hiringFee`);
  if (driver.requiredCompanyLevel !== undefined) {
    validator.positiveInteger(driver.requiredCompanyLevel, `${path}.requiredCompanyLevel`);
  }
}
