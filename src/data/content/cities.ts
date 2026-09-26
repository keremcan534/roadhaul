import type { CityDefinition } from '../definitions/CityDefinition';

/**
 * The MVP's three cities (spec §20), and a mining town that came with the
 * bigger map. The map is original: no real-world copies.
 */
export const CITIES: readonly CityDefinition[] = [
  { id: 'city_a', specialization: 'starter' },
  { id: 'city_b', specialization: 'industrial' },
  { id: 'city_c', specialization: 'agricultural' },
  { id: 'city_d', specialization: 'mining' },
];
