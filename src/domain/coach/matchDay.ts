/**
 * The stadiums' match every evening (PlaceDefinition kind `stadium`), by the
 * game's clock: in the hours before kick-off the coach stations run the
 * fans' charter there (CoachLineService), then the match is on. Pure.
 */

/** Where the day stands for a stadium: quiet, the fans' charter running, or the match on. */
export const MATCH_PHASES = ['quiet', 'charter', 'match'] as const;
export type MatchPhase = (typeof MATCH_PHASES)[number];

/** The match's hours (GameConfig.coachLines.charter): the charter from `fromHour`, kick-off, and how long it lasts. */
export interface MatchHours {
  readonly fromHour: number;
  readonly kickOffHour: number;
  readonly matchHours: number;
}

/** Where the day stands at `hour` (0–24, local). */
export function matchPhase(hour: number, hours: MatchHours): MatchPhase {
  if (hour >= hours.fromHour && hour < hours.kickOffHour) {
    return 'charter';
  }
  return hour >= hours.kickOffHour && hour < hours.kickOffHour + hours.matchHours ? 'match' : 'quiet';
}
