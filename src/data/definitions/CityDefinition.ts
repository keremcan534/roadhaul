import type { Validator } from '../../core/validation/Validator';

/**
 * City roles from spec §20 (A = starting city, B = industrial, C = agricultural), a mining town's (D), and those of
 * the towns at the corners: a fishing port (E), a quarry town (F) and a market town (G).
 */
export const CITY_SPECIALIZATIONS = ['starter', 'industrial', 'agricultural', 'mining', 'coastal', 'quarry', 'market'] as const;
export type CitySpecialization = (typeof CITY_SPECIALIZATIONS)[number];

/**
 * Static description of a city. Its depot is on the map (DepotDefinition).
 * Region, map placement and the road graph arrive with the 3-city prototype
 * (roadmap step 21).
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
