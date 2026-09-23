import type { Validator } from '../../core/validation/Validator';

/** City roles from spec §20: A = starting city, B = industrial, C = agricultural. */
export const CITY_SPECIALIZATIONS = ['starter', 'industrial', 'agricultural'] as const;
export type CitySpecialization = (typeof CITY_SPECIALIZATIONS)[number];

/**
 * Static description of a city. Placeholder: region, depots, map placement and
 * the road graph arrive with the 3-city prototype (roadmap step 21).
 */
export interface CityDefinition {
  /** Stable snake_case id. It is written into save files: never rename it. */
  readonly id: string;
  readonly specialization: CitySpecialization;
}

export function validateCityDefinition(city: CityDefinition, path: string, validator: Validator): void {
  validator.id(city.id, `${path}.id`);
  validator.oneOf(city.specialization, CITY_SPECIALIZATIONS, `${path}.specialization`);
}
