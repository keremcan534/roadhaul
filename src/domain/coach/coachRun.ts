import type { Credits } from '../../data/units';

/**
 * A coach line's run (the owner's bus job): who waits at the stops, how
 * the ride feels to them and what the run pays. Pure: CoachLineService
 * drives it.
 */

/** The hours (local) people travel most, and least: more wait in the rush hours, fewer at night. */
const RUSH_HOURS: readonly (readonly [number, number])[] = [
  [7, 9],
  [16, 19],
];
const NIGHT_FROM_HOUR = 22;
const NIGHT_TO_HOUR = 5;
const RUSH_FACTOR = 1.5;
const NIGHT_FACTOR = 0.35;

/**
 * People waiting at a stop at `hour` (0–24, local): `chance` (0–1, the
 * stop's luck) through the `waiting` range, half as many again in the rush
 * hours, about a third at night.
 */
export function peopleWaiting(waiting: readonly [number, number], hour: number, chance: number): number {
  const [least, most] = waiting;
  let factor = 1;
  if (hour >= NIGHT_FROM_HOUR || hour < NIGHT_TO_HOUR) {
    factor = NIGHT_FACTOR;
  } else if (RUSH_HOURS.some(([from, to]) => hour >= from && hour < to)) {
    factor = RUSH_FACTOR;
  }
  return Math.max(0, Math.round((least + (most - least) * Math.min(1, Math.max(0, chance))) * factor));
}

/** How many of `onBoard` get off at a stop: `share` of them, all at the last stop. */
export function peopleGettingOff(onBoard: number, share: number, lastStop: boolean): number {
  return lastStop ? onBoard : Math.min(onBoard, Math.round(onBoard * share));
}

/** What a stop costs in time: the doors, then each person off and on, seconds. */
export function dwellSeconds(doorSeconds: number, secondsPerPerson: number, people: number): number {
  return doorSeconds + secondsPerPerson * people;
}

/** How the ride feels: 100 at the start, less for each hard pull and knock (CoachLineService). */
export class ComfortMeter {
  value = 100;

  constructor(
    private readonly gentlePull: number,
    private readonly perPull: number,
    private readonly perKnock: number,
  ) {}

  /** A step of `seconds` with these pulls along and across the road (m/s²), while people are on board. Allocation-free. */
  ride(alongPull: number, acrossPull: number, seconds: number): void {
    const over = Math.max(0, Math.abs(alongPull) - this.gentlePull) + Math.max(0, Math.abs(acrossPull) - this.gentlePull);
    if (over > 0) {
      this.value = Math.max(0, this.value - over * this.perPull * seconds);
    }
  }

  /** A knock (a crash) with people on board. */
  knock(): void {
    this.value = Math.max(0, this.value - this.perKnock);
  }

  reset(): void {
    this.value = 100;
  }
}

/** What a run of a coach line earned. */
export interface CoachRunPay {
  /** People carried to where they were going. */
  readonly passengers: number;
  readonly fares: Credits;
  readonly onTimeBonus: Credits;
  readonly comfortBonus: Credits;
  readonly total: Credits;
  readonly xp: number;
  /** 1 for the run done, one more for every stop on time, one more for a comfortable ride; 0 for one given up. */
  readonly stars: 0 | 1 | 2 | 3;
}

/** A ride this comfortable or more earns its star. */
export const COMFORT_STAR = 80;

export interface CoachRunRules {
  readonly fareCredits: Credits;
  readonly onTimeBonusShare: number;
  readonly comfortBonusShare: number;
  readonly xpPerPassenger: number;
}

/**
 * What a run pays: the fares of everyone carried; for a run finished, a
 * bonus share of them for keeping to the timetable at every town's stop and
 * one for the comfort kept (in proportion). A run given up pays the fares of
 * those already off and nothing more.
 */
export function coachRunPay(
  rules: CoachRunRules,
  run: { readonly passengers: number; readonly finished: boolean; readonly allOnTime: boolean; readonly comfort: number },
): CoachRunPay {
  const fares = run.passengers * rules.fareCredits;
  const onTimeBonus = run.finished && run.allOnTime ? Math.round(fares * rules.onTimeBonusShare) : 0;
  const comfortBonus = run.finished ? Math.round((fares * rules.comfortBonusShare * Math.min(100, Math.max(0, run.comfort))) / 100) : 0;
  const stars = run.finished ? ((1 + (run.allOnTime ? 1 : 0) + (run.comfort >= COMFORT_STAR ? 1 : 0)) as 1 | 2 | 3) : 0;
  return {
    passengers: run.passengers,
    fares,
    onTimeBonus,
    comfortBonus,
    total: fares + onTimeBonus + comfortBonus,
    xp: run.passengers * rules.xpPerPassenger,
    stars,
  };
}
