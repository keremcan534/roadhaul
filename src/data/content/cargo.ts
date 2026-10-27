import type { CargoDefinition } from '../definitions/CargoDefinition';

/**
 * The cargo set (spec §11). Five travel in a plain box and fit the starting
 * truck; chilled and frozen goods need a refrigerated body and building
 * materials a flatbed, which arrive with the garage (step 19). Fuel and milk
 * need the tanker, gravel and copper ore the tipper (the trucks of levels 4
 * and 5).
 */
export const CARGO: readonly CargoDefinition[] = [
  {
    id: 'packaged_food',
    category: 'food',
    rewardMultiplier: 1,
    damageSensitivity: 0.3,
    timeSensitivity: 0.5,
    temperature: 'none',
    requiredBody: 'box',
  },
  {
    id: 'consumer_electronics',
    category: 'electronics',
    rewardMultiplier: 1.5,
    damageSensitivity: 0.85,
    timeSensitivity: 0.4,
    temperature: 'none',
    requiredBody: 'box',
  },
  {
    id: 'furniture',
    category: 'furniture',
    rewardMultiplier: 1.15,
    damageSensitivity: 0.55,
    timeSensitivity: 0.3,
    temperature: 'none',
    requiredBody: 'box',
  },
  {
    id: 'farm_produce',
    category: 'agriculture',
    rewardMultiplier: 0.9,
    damageSensitivity: 0.35,
    timeSensitivity: 0.6,
    temperature: 'none',
    requiredBody: 'box',
  },
  {
    id: 'machine_parts',
    category: 'automotive',
    rewardMultiplier: 1.25,
    damageSensitivity: 0.3,
    timeSensitivity: 0.4,
    temperature: 'none',
    requiredBody: 'box',
  },
  {
    id: 'frozen_food',
    category: 'frozenFood',
    rewardMultiplier: 1.35,
    damageSensitivity: 0.35,
    timeSensitivity: 0.8,
    temperature: 'frozen',
    requiredBody: 'refrigerated',
  },
  {
    id: 'medical_supplies',
    category: 'medical',
    rewardMultiplier: 1.6,
    damageSensitivity: 0.7,
    timeSensitivity: 0.9,
    temperature: 'chilled',
    requiredBody: 'refrigerated',
  },
  {
    id: 'construction_materials',
    category: 'construction',
    rewardMultiplier: 1.1,
    damageSensitivity: 0.15,
    timeSensitivity: 0.3,
    temperature: 'none',
    requiredBody: 'flatbed',
  },
  {
    id: 'fuel',
    category: 'hazardous',
    rewardMultiplier: 1.8,
    damageSensitivity: 0.9,
    timeSensitivity: 0.5,
    temperature: 'none',
    requiredBody: 'tanker',
  },
  {
    id: 'milk',
    category: 'food',
    rewardMultiplier: 1.2,
    damageSensitivity: 0.4,
    timeSensitivity: 0.85,
    temperature: 'none',
    requiredBody: 'tanker',
  },
  {
    id: 'gravel',
    category: 'construction',
    rewardMultiplier: 0.85,
    damageSensitivity: 0.05,
    timeSensitivity: 0.25,
    temperature: 'none',
    requiredBody: 'tipper',
  },
  {
    id: 'copper_ore',
    category: 'construction',
    rewardMultiplier: 1.05,
    damageSensitivity: 0.05,
    timeSensitivity: 0.3,
    temperature: 'none',
    requiredBody: 'tipper',
  },
];
