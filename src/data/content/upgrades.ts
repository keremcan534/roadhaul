import type { UpgradeDefinition } from '../definitions/UpgradeDefinition';

/**
 * The MVP's five upgrade types (spec §16, §43), each with three levels. Every
 * truck is upgraded on its own. The cheapest levels are affordable after the
 * first deliveries (spec §41: "the first upgrade unlocks"); higher levels wait
 * for company levels. Names come from the string tables (`upgrade.<id>.name`).
 *
 * Each shows on the truck (`look`): the engine in its exhaust stacks, the
 * tyres in their rims, the suspension in the truck's stance.
 *
 * The gearbox and cabin upgrades of spec §16 come later.
 */
export const UPGRADES: readonly UpgradeDefinition[] = [
  {
    id: 'engine',
    look: 'exhaust',
    levels: [
      {
        cost: 3000,
        modifiers: [
          { stat: 'enginePower', bonus: 0.08 },
          { stat: 'fuelEfficiency', bonus: 0.03 },
        ],
      },
      {
        cost: 6000,
        requiredCompanyLevel: 2,
        modifiers: [
          { stat: 'enginePower', bonus: 0.16 },
          { stat: 'fuelEfficiency', bonus: 0.05 },
        ],
      },
      {
        cost: 10000,
        requiredCompanyLevel: 3,
        modifiers: [
          { stat: 'enginePower', bonus: 0.25 },
          { stat: 'fuelEfficiency', bonus: 0.08 },
        ],
      },
    ],
  },
  {
    id: 'brakes',
    look: 'brakes',
    levels: [
      { cost: 2000, modifiers: [{ stat: 'brakingPower', bonus: 0.1 }] },
      { cost: 4000, requiredCompanyLevel: 2, modifiers: [{ stat: 'brakingPower', bonus: 0.2 }] },
      { cost: 7000, requiredCompanyLevel: 3, modifiers: [{ stat: 'brakingPower', bonus: 0.3 }] },
    ],
  },
  {
    id: 'tires',
    look: 'wheels',
    levels: [
      { cost: 2500, modifiers: [{ stat: 'grip', bonus: 0.06 }] },
      { cost: 5000, requiredCompanyLevel: 2, modifiers: [{ stat: 'grip', bonus: 0.12 }] },
      { cost: 8000, requiredCompanyLevel: 3, modifiers: [{ stat: 'grip', bonus: 0.18 }] },
    ],
  },
  {
    id: 'suspension',
    look: 'stance',
    levels: [
      {
        cost: 3000,
        requiredCompanyLevel: 2,
        modifiers: [
          { stat: 'cargoProtection', bonus: 0.15 },
          { stat: 'stability', bonus: 0.05 },
        ],
      },
      {
        cost: 6000,
        requiredCompanyLevel: 3,
        modifiers: [
          { stat: 'cargoProtection', bonus: 0.3 },
          { stat: 'stability', bonus: 0.1 },
        ],
      },
      {
        cost: 9000,
        requiredCompanyLevel: 4,
        modifiers: [
          { stat: 'cargoProtection', bonus: 0.45 },
          { stat: 'stability', bonus: 0.15 },
        ],
      },
    ],
  },
  {
    id: 'fuel_tank',
    look: 'fuelTank',
    levels: [
      { cost: 1500, modifiers: [{ stat: 'fuelCapacity', bonus: 0.2 }] },
      { cost: 3000, requiredCompanyLevel: 2, modifiers: [{ stat: 'fuelCapacity', bonus: 0.4 }] },
      { cost: 5000, requiredCompanyLevel: 3, modifiers: [{ stat: 'fuelCapacity', bonus: 0.6 }] },
    ],
  },
];
