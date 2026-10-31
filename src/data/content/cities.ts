import type { CityDefinition } from '../definitions/CityDefinition';

/**
 * The MVP's three cities (spec §20), a mining town that came with the bigger
 * map, and three towns toward its corners: a fishing port on the south-west
 * bay, a quarry town under the north-east hills and a market town in the
 * south-east. The map is original: no real-world copies.
 */
export const CITIES: readonly CityDefinition[] = [
  { id: 'city_a', specialization: 'starter' },
  { id: 'city_b', specialization: 'industrial' },
  { id: 'city_c', specialization: 'agricultural' },
  { id: 'city_d', specialization: 'mining' },
  { id: 'city_e', specialization: 'coastal' },
  { id: 'city_f', specialization: 'quarry' },
  { id: 'city_g', specialization: 'market' },
];
