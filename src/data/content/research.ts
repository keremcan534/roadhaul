import type { ResearchDefinition } from '../definitions/ResearchDefinition';

/**
 * The research tree: three branches of four tiers. Logistics loads faster
 * and brings more contracts, engineering keeps the cargo whole and saves
 * diesel, business pays more and grows the company. A tier costs the same in
 * every branch; the third needs company level 4, the fourth level 6. A
 * delivery earns a research point, a perfect one two (GameConfig.research),
 * so the first steps come in the first hour and the last in the late game.
 */
export const RESEARCH: readonly ResearchDefinition[] = [
  { id: 'quick_loading', branch: 'logistics', tier: 1, effect: 'loadingTimeReduction', value: 0.15, points: 3, cost: 2000 },
  { id: 'dispatch_planning', branch: 'logistics', tier: 2, effect: 'extraContracts', value: 1, points: 6, cost: 5000 },
  {
    id: 'express_handling',
    branch: 'logistics',
    tier: 3,
    effect: 'loadingTimeReduction',
    value: 0.2,
    points: 10,
    cost: 9000,
    requiredCompanyLevel: 4,
  },
  {
    id: 'logistics_network',
    branch: 'logistics',
    tier: 4,
    effect: 'extraContracts',
    value: 1,
    points: 16,
    cost: 15000,
    requiredCompanyLevel: 6,
  },
  { id: 'eco_driving', branch: 'engineering', tier: 1, effect: 'fuelUseReduction', value: 0.05, points: 3, cost: 2000 },
  { id: 'cargo_straps', branch: 'engineering', tier: 2, effect: 'cargoDamageReduction', value: 0.15, points: 6, cost: 5000 },
  {
    id: 'efficient_engines',
    branch: 'engineering',
    tier: 3,
    effect: 'fuelUseReduction',
    value: 0.07,
    points: 10,
    cost: 9000,
    requiredCompanyLevel: 4,
  },
  {
    id: 'shock_mounts',
    branch: 'engineering',
    tier: 4,
    effect: 'cargoDamageReduction',
    value: 0.2,
    points: 16,
    cost: 15000,
    requiredCompanyLevel: 6,
  },
  { id: 'better_rates', branch: 'business', tier: 1, effect: 'deliveryPayBonus', value: 0.03, points: 3, cost: 2000 },
  { id: 'training_program', branch: 'business', tier: 2, effect: 'xpBonus', value: 0.05, points: 6, cost: 5000 },
  {
    id: 'premium_clients',
    branch: 'business',
    tier: 3,
    effect: 'deliveryPayBonus',
    value: 0.04,
    points: 10,
    cost: 9000,
    requiredCompanyLevel: 4,
  },
  {
    id: 'brand_power',
    branch: 'business',
    tier: 4,
    effect: 'marketShareBonus',
    value: 0.1,
    points: 16,
    cost: 15000,
    requiredCompanyLevel: 6,
  },
];
