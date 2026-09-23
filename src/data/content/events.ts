import type { EventDefinition } from '../definitions/EventDefinition';

/**
 * The first three events (spec §78). Each runs for a week every other week,
 * starting on a Monday (Heavy Cargo on a Thursday), so at any time one or
 * two are on. The job board's contracts are the ones they count.
 */
export const EVENTS: readonly EventDefinition[] = [
  {
    // Spec §78 Express Week: a bonus for fast deliveries.
    id: 'express_week',
    schedule: { startDate: '2026-01-05', durationDays: 7, repeatEveryDays: 14 },
    qualifyingDelivery: { minTimeLeft: 0.25 },
    objective: { kind: 'deliveries', target: 4 },
    reward: { credits: 3000, xp: 300 },
    payBonus: 0.25,
  },
  {
    // Spec §78 Safe Driver: a reward for damage-free deliveries.
    id: 'safe_driver',
    schedule: { startDate: '2026-01-12', durationDays: 7, repeatEveryDays: 14 },
    qualifyingDelivery: { maxCargoDamage: 0 },
    objective: { kind: 'deliveries', target: 3 },
    reward: { credits: 2500, xp: 250 },
    payBonus: 0.15,
  },
  {
    // Spec §78 Heavy Cargo: heavy loads, for companies with a truck big enough to carry them.
    id: 'heavy_cargo',
    schedule: { startDate: '2026-01-08', durationDays: 7, repeatEveryDays: 14 },
    requiredCompanyLevel: 2,
    qualifyingDelivery: { minCargoWeightTons: 8 },
    objective: { kind: 'credits', target: 15000 },
    reward: { credits: 5000, xp: 500 },
    payBonus: 0.3,
  },
];
