import type { CityDefinition } from '../definitions/CityDefinition';

/** The three MVP cities (spec §20). The map is original: no real-world copies. */
export const CITIES: readonly CityDefinition[] = [
  { id: 'city_a', specialization: 'starter' },
  { id: 'city_b', specialization: 'industrial' },
  { id: 'city_c', specialization: 'agricultural' },
];
