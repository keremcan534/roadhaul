import type { Validator } from '../../core/validation/Validator';
import type { Fraction } from '../units';

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
 * Static description of a cargo type: the spec's CargoType ScriptableObject.
 * Placeholder: trailer requirements and volume arrive with the cargo data step
 * (roadmap step 09). The weight belongs to each mission, not to the cargo type.
 */
export interface CargoDefinition {
  /** Stable snake_case id. It is written into save files: never rename it. */
  readonly id: string;
  readonly category: CargoCategory;
  /** Reward multiplier ("CargoMultiplier", spec §64). 1 is the baseline. */
  readonly rewardMultiplier: number;
  /** How much driving damage reaches the cargo: 0 = sturdy, 1 = very fragile. */
  readonly damageSensitivity: Fraction;
  /** How strongly late delivery is penalised: 0 = not at all, 1 = strongly. */
  readonly timeSensitivity: Fraction;
  readonly temperature: TemperatureRequirement;
}

export function validateCargoDefinition(cargo: CargoDefinition, path: string, validator: Validator): void {
  validator.id(cargo.id, `${path}.id`);
  validator.oneOf(cargo.category, CARGO_CATEGORIES, `${path}.category`);
  validator.positiveNumber(cargo.rewardMultiplier, `${path}.rewardMultiplier`);
  validator.fraction(cargo.damageSensitivity, `${path}.damageSensitivity`);
  validator.fraction(cargo.timeSensitivity, `${path}.timeSensitivity`);
  validator.oneOf(cargo.temperature, TEMPERATURE_REQUIREMENTS, `${path}.temperature`);
}
