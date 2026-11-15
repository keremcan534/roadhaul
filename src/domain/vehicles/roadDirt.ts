import { clamp } from '../../core/math/scalar';
import type { GameConfig } from '../../data/config/GameConfig';
import type { Fraction } from '../../data/units';

/** How a truck looks for its dirt, from just washed to caked. */
export const DIRT_LEVELS = ['clean', 'dusty', 'dirty', 'filthy'] as const;
export type DirtLevel = (typeof DIRT_LEVELS)[number];

/** Each level from this much dirt on. */
const LEVEL_FROM: Readonly<Record<DirtLevel, Fraction>> = { clean: 0, dusty: 0.15, dirty: 0.45, filthy: 0.75 };

/** How the road dirties a truck (GameConfig.roadDirt). */
export type RoadDirtConfig = GameConfig['roadDirt'];

/** What the road is like under the truck. */
export interface DirtConditions {
  /** How wet the road is (WeatherService.wetness): its spray. */
  readonly wetness: Fraction;
  /** Snow falling: slush thrown up. */
  readonly snowy: boolean;
  /** Off the road, on the grass and the earth. */
  readonly offRoad: boolean;
}

/** The look of `dirt` (0 clean to 1 caked). */
export function dirtLevel(dirt: Fraction): DirtLevel {
  return dirt >= LEVEL_FROM.filthy ? 'filthy' : dirt >= LEVEL_FROM.dirty ? 'dirty' : dirt >= LEVEL_FROM.dusty ? 'dusty' : 'clean';
}

/**
 * The dirt `meters` driven throw up on the truck: on a dry road it is caked
 * after `dryKilometers`, faster as the road is wetter (its spray), in the
 * snow's slush, and fastest off the road.
 */
export function dirtThrownUp(meters: number, conditions: DirtConditions, config: RoadDirtConfig): Fraction {
  const wet = 1 + (config.wetFactor - 1) * clamp(conditions.wetness, 0, 1);
  const factor = conditions.offRoad ? config.offRoadFactor : Math.max(wet, conditions.snowy ? config.snowFactor : 1);
  return (Math.max(0, meters) * factor) / (config.dryKilometers * 1000);
}
