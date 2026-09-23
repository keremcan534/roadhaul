import type { CargoDefinition } from '../definitions/CargoDefinition';

/** Placeholder cargo types. The MVP set (6–8 types) arrives with roadmap step 09. */
export const CARGO: readonly CargoDefinition[] = [
  {
    id: 'packaged_food',
    category: 'food',
    rewardMultiplier: 1,
    damageSensitivity: 0.3,
    timeSensitivity: 0.5,
    temperature: 'none',
  },
  {
    id: 'consumer_electronics',
    category: 'electronics',
    rewardMultiplier: 1.4,
    damageSensitivity: 0.8,
    timeSensitivity: 0.3,
    temperature: 'none',
  },
];
