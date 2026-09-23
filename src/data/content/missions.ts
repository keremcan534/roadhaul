import type { MissionDefinition } from '../definitions/MissionDefinition';

/**
 * Placeholder missions, the first entries of the spec's "first 10 missions"
 * list (§77). Rewards and limits are unbalanced placeholders until the economy
 * step (roadmap step 14).
 */
export const MISSIONS: readonly MissionDefinition[] = [
  {
    id: 'first_package',
    originCityId: 'city_a',
    destinationCityId: 'city_b',
    cargoId: 'packaged_food',
    cargoWeightTons: 3,
    baseReward: 1200,
    timeLimitSeconds: 900,
    damageTolerance: 0.25,
    difficulty: 'easy',
  },
  {
    id: 'fragile_electronics',
    originCityId: 'city_b',
    destinationCityId: 'city_c',
    cargoId: 'consumer_electronics',
    cargoWeightTons: 2,
    baseReward: 2200,
    timeLimitSeconds: 1200,
    damageTolerance: 0.1,
    difficulty: 'normal',
  },
];
