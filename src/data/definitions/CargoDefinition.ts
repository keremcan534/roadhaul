import type { Validator } from '../../core/validation/Validator';
import type { Fraction } from '../units';
import { BODY_TYPES, type BodyType } from './BodyType';

/** Cargo families from spec §11. The MVP ships 6–8 cargo types across a subset of these. */
export const CARGO_CATEGORIES = [
  'food',
  'frozenFood',
  'electronics',
  'furniture',
  'construction',
  'agriculture',
  'automotive',
  'medical',
  'fragile',
  'hazardous',
  'oversized',
] as const;
export type CargoCategory = (typeof CARGO_CATEGORIES)[number];

export const TEMPERATURE_REQUIREMENTS = ['none', 'chilled', 'frozen'] as const;
export type TemperatureRequirement = (typeof TEMPERATURE_REQUIREMENTS)[number];

/**
 * Static description of a cargo type: the spec's CargoType ScriptableObject
 * (spec §11). The weight belongs to each mission, not to the cargo type.
 * Player-facing names come from the string tables (`cargo.<id>.name`).
 */
export interface CargoDefinition {
  /** Stable snake_case id. It is written into save files: never rename it. */
  readonly id: string;
  readonly category: CargoCategory;
  /** Reward multiplier ("CargoMultiplier", spec §64). 1 is the baseline. */
  readonly rewardMultiplier: number;
  /** How much driving damage reaches the cargo: 0 = sturdy, 1 = very fragile. */
  readonly damageSensitivity: Fraction;
  /** How much punctuality matters: 0 = little (small on-time bonus, mild late penalty), 1 = a lot. */
  readonly timeSensitivity: Fraction;
  readonly temperature: TemperatureRequirement;
  /** The truck body this cargo travels in (see bodyCanHaul). Chilled and frozen cargo needs a refrigerated body. */
  readonly requiredBody: BodyType;
}

export function validateCargoDefinition(cargo: CargoDefinition, path: string, validator: Validator): void {
  validator.id(cargo.id, `${path}.id`);
  validator.oneOf(cargo.category, CARGO_CATEGORIES, `${path}.category`);
  validator.positiveNumber(cargo.rewardMultiplier, `${path}.rewardMultiplier`);
  validator.fraction(cargo.damageSensitivity, `${path}.damageSensitivity`);
  validator.fraction(cargo.timeSensitivity, `${path}.timeSensitivity`);
  validator.oneOf(cargo.temperature, TEMPERATURE_REQUIREMENTS, `${path}.temperature`);
  if (validator.oneOf(cargo.requiredBody, BODY_TYPES, `${path}.requiredBody`)) {
    validator.check(
      cargo.temperature === 'none' || cargo.requiredBody === 'refrigerated',
      `${path}.requiredBody`,
      'chilled and frozen cargo needs a refrigerated body',
    );
  }
}
