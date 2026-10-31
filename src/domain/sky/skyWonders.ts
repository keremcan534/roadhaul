import type { Season } from '../../data/definitions/Season';
import type { Fraction } from '../../data/units';

/** The sky's wonders a player may see: the northern lights, a shooting star, a rainbow. */
export const SKY_WONDERS = ['aurora', 'meteor', 'rainbow'] as const;
export type SkyWonder = (typeof SKY_WONDERS)[number];

/** A night's sky is dark from this much of the night's look (TimeOfDayService.weights.night). */
export const NIGHT_FROM = 0.5;

/** Whether tonight has the northern lights: `roll` (uniform in [0, 1)) under the season's chance. */
export function auroraTonight(roll: number, season: Season, chances: Readonly<Record<Season, Fraction>>): boolean {
  return roll < chances[season];
}
