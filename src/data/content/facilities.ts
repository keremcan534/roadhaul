import type { FacilityDefinition } from '../definitions/FacilityDefinition';

/**
 * The company's facilities, built at the head office a level at a time: each
 * helps the whole company one way, and costs more the bigger it grows. Prices
 * sit between the trucks' upgrades and the trucks themselves.
 */
export const FACILITIES: readonly FacilityDefinition[] = [
  {
    id: 'workshop',
    effect: 'repairDiscount',
    levels: [
      { cost: 5000, value: 0.15 },
      { cost: 12000, requiredCompanyLevel: 2, value: 0.3 },
      { cost: 24000, requiredCompanyLevel: 4, value: 0.45 },
    ],
  },
  {
    id: 'fuel_depot',
    effect: 'fuelDiscount',
    levels: [
      { cost: 6000, value: 0.1 },
      { cost: 14000, requiredCompanyLevel: 3, value: 0.2 },
      { cost: 28000, requiredCompanyLevel: 4, value: 0.3 },
    ],
  },
  {
    id: 'truck_yard',
    effect: 'garageSlots',
    levels: [
      { cost: 8000, requiredCompanyLevel: 2, value: 1 },
      { cost: 18000, requiredCompanyLevel: 3, value: 2 },
      { cost: 36000, requiredCompanyLevel: 5, value: 4 },
    ],
  },
  {
    id: 'dispatch_office',
    effect: 'fleetPayBonus',
    levels: [
      { cost: 7000, requiredCompanyLevel: 2, value: 0.1 },
      { cost: 16000, requiredCompanyLevel: 3, value: 0.2 },
      { cost: 32000, requiredCompanyLevel: 5, value: 0.35 },
    ],
  },
  {
    id: 'marketing_office',
    effect: 'marketShareBonus',
    levels: [
      { cost: 6000, requiredCompanyLevel: 2, value: 0.15 },
      { cost: 15000, requiredCompanyLevel: 3, value: 0.3 },
      { cost: 30000, requiredCompanyLevel: 5, value: 0.5 },
    ],
  },
  {
    id: 'training_centre',
    effect: 'xpBonus',
    levels: [
      { cost: 5000, value: 0.1 },
      { cost: 12000, requiredCompanyLevel: 3, value: 0.2 },
      { cost: 26000, requiredCompanyLevel: 4, value: 0.3 },
    ],
  },
  {
    id: 'logistics_office',
    effect: 'extraContracts',
    levels: [
      { cost: 4000, value: 1 },
      { cost: 10000, requiredCompanyLevel: 2, value: 2 },
      { cost: 22000, requiredCompanyLevel: 4, value: 3 },
    ],
  },
];
