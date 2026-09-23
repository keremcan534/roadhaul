/**
 * Shared unit aliases. They add no type safety on their own; they document
 * what a number means. Other units are spelled out in field names instead
 * (`timeLimitSeconds`, `fuelCapacityLiters`, `maxSpeedKmh`, `cargoWeightTons`).
 */

/** A ratio in the closed range 0..1. The UI shows it as a percentage. */
export type Fraction = number;

/** In-game currency ("Credit", spec §13). Always a whole number. */
export type Credits = number;
