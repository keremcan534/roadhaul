/** How the ground under the wheels affects driving. */
export interface Surface {
  readonly name: 'asphalt' | 'grass';
  /** Multiplies the tyre grip: less grip means earlier understeer and longer braking. */
  readonly gripFactor: number;
  /** Rolling resistance coefficient: the force is this × weight. */
  readonly rollingResistance: number;
  /** Multiplies fuel consumption (spec §17 terrainModifier). */
  readonly fuelFactor: number;
}

export const ASPHALT: Surface = Object.freeze({ name: 'asphalt', gripFactor: 1, rollingResistance: 0.009, fuelFactor: 1 });

/** Off-road: slippery and slow (tops out well below highway speed), so leaving the road is noticeable but not a trap. */
export const GRASS: Surface = Object.freeze({ name: 'grass', gripFactor: 0.6, rollingResistance: 0.12, fuelFactor: 1.35 });
