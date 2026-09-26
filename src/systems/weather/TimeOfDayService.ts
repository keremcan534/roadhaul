import { degreesToRadians, smoothstep } from '../../core/math/scalar';
import type { Clock } from '../../core/time/Clock';
import { MINUTES_PER_DAY, wrapMinutes } from '../../core/time/dayTime';
import type { TimeFlow } from '../../data/config/controls';
import type { GameConfig } from '../../data/config/GameConfig';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { DaylightDefinition, DaylightPhase } from '../../data/definitions/DaylightDefinition';
import { daylightWeights, type DaylightWeights } from '../../domain/sky/skyLook';
import {
  dayOfYear,
  moonDeclination,
  moonHourAngle,
  moonIllumination,
  moonPhase,
  skyDirection,
  starTurn,
  sunDeclination,
  sunHourAngle,
  type SkyDirection,
} from '../../domain/sky/solar';

/** The sun's disc sets between these elevations, degrees: its light goes, the sky's glow stays. */
const SUNSET_DEGREES = { below: -1, above: 3 } as const;
/** The moon lights the night from this elevation up, fully from the next (degrees). */
const MOONRISE_DEGREES = { below: -2, above: 6 } as const;
/** How many steps the search for a time of day (timeOf) halves its window: under a second of the day. */
const SEARCH_STEPS = 24;
/** The times the Settings offer, rounded to this many minutes. */
const PRESET_ROUNDING_MINUTES = 5;

/** The times of day the Settings offer: dawn, the morning, noon, dusk and the night. */
export const CLOCK_PRESETS = ['dawn', 'morning', 'noon', 'dusk', 'night'] as const;
export type ClockPreset = (typeof CLOCK_PRESETS)[number];

/** The time of day as the world shows it: full day, dawn, dusk or night (whichever look the sky takes most). */
export type DaylightShown = 'day' | DaylightPhase;

/**
 * The game's clock and the sky it turns (spec §39, the time of day apart
 * from the weather). The clock passes `gameSecondsPerSecond` times faster
 * than real time, stands still, or keeps the phone's time (TimeFlow). From
 * it and the calendar's date (the Clock) it places the sun on its real path
 * over the region, the moon by its phase and the stars round the pole, and
 * says how much of the day's, dawn's or dusk's and the night's look the sky
 * takes (`weights`), and how fast traffic drives in the dark. Call update()
 * every fixed step. Allocation-free.
 */
export class TimeOfDayService {
  /** Toward the sun and the moon, in the world's axes (x east, y up, z south). Updated in place. */
  readonly sun: SkyDirection = { x: 0, y: 1, z: 0 };
  readonly moon: SkyDirection = { x: 0, y: -1, z: 0 };
  /** How much of each look the sky takes now (daylightWeights). Updated in place. */
  readonly weights: DaylightWeights = { day: 1, twilight: 0, night: 0 };
  private minutesValue: number;
  private flowValue: TimeFlow = 'passes';
  private readonly latitude: number;
  private readonly dawn: DaylightDefinition;
  private readonly dusk: DaylightDefinition;
  private readonly night: DaylightDefinition;
  private rising = true;
  private sunElevation = 90;
  private moonElevation = -90;
  private phaseValue = 0;
  private starTurnValue = 0;
  private readonly scratch: SkyDirection = { x: 0, y: 0, z: 0 };

  constructor(
    content: ContentCatalog,
    private readonly clock: Clock,
    private readonly config: GameConfig['timeOfDay'],
    /** Minutes the phone's time zone runs ahead of UTC, for the `device` flow. */
    private readonly localOffsetMinutes = 0,
  ) {
    this.dawn = content.daylight.get('dawn');
    this.dusk = content.daylight.get('dusk');
    this.night = content.daylight.get('night');
    this.latitude = degreesToRadians(config.latitudeDegrees);
    this.minutesValue = wrapMinutes(config.startMinutes);
    this.place();
  }

  /** The time of day, minutes after midnight (0 to under 1440). */
  get minutes(): number {
    return this.minutesValue;
  }

  /** How the clock goes. */
  get flow(): TimeFlow {
    return this.flowValue;
  }

  set flow(flow: TimeFlow) {
    this.flowValue = flow;
    this.update(0);
  }

  /** Sets the clock (`minutes` after midnight, any day), and the sky with it. Ignored while it keeps the phone's time. */
  set(minutes: number): void {
    if (this.flowValue !== 'device' && Number.isFinite(minutes)) {
      this.minutesValue = wrapMinutes(minutes);
      this.place();
    }
  }

  /** How high the sun stands, degrees above the horizon (negative below it). */
  get sunElevationDegrees(): number {
    return this.sunElevation;
  }

  /** How high the moon stands, degrees. */
  get moonElevationDegrees(): number {
    return this.moonElevation;
  }

  /** How much of the sun stands above the horizon: 1 up, 0 set, between while its disc goes down (or comes up). */
  get sunUp(): number {
    return smoothstep(SUNSET_DEGREES.below, SUNSET_DEGREES.above, this.sunElevation);
  }

  /** How far through its phases the moon is: 0 new, 0.5 full. */
  get moonPhase(): number {
    return this.phaseValue;
  }

  /** How bright the moon is: its lit share, and how far it is up. */
  get moonlit(): number {
    return moonIllumination(this.phaseValue) * smoothstep(MOONRISE_DEGREES.below, MOONRISE_DEGREES.above, this.moonElevation);
  }

  /** How far the stars have turned round the pole, radians. */
  get starTurn(): number {
    return this.starTurnValue;
  }

  /** The twilight the sky passes through now: dawn's with the sun rising (the morning), dusk's with it setting. */
  get twilight(): DaylightDefinition {
    return this.rising ? this.dawn : this.dusk;
  }

  /** The night's look. */
  get nightLook(): DaylightDefinition {
    return this.night;
  }

  /** The look the sky takes most: day, dawn, dusk or night. */
  get shown(): DaylightShown {
    const { day, twilight, night } = this.weights;
    if (night >= day && night >= twilight) {
      return 'night';
    }
    if (twilight > day) {
      return this.rising ? 'dawn' : 'dusk';
    }
    return 'day';
  }

  /** Traffic drives at this share of its usual speed at this time of day (fewer, slower drivers in the dark). */
  get trafficSpeedFactor(): number {
    const { day, twilight, night } = this.weights;
    return day + twilight * this.twilight.trafficSpeedFactor + night * this.night.trafficSpeedFactor;
  }

  /** Moves the clock `dt` seconds on (as fast as the flow says), and the sky with it. Allocation-free. */
  update(dt: number): void {
    if (this.flowValue === 'device') {
      this.minutesValue = wrapMinutes(this.clock.now() / 60_000 + this.localOffsetMinutes);
    } else if (this.flowValue === 'passes' && dt > 0) {
      this.minutesValue = wrapMinutes(this.minutesValue + (dt * this.config.gameSecondsPerSecond) / 60);
    }
    this.place();
  }

  /**
   * The time today (minutes after midnight, rounded to five) of a moment the
   * Settings offer: dawn and dusk when the sun stands where their looks are
   * exactly so, noon when it stands highest, the morning halfway from dawn
   * to noon, and the night two hours past the end of the evening's twilight
   * (or 23:00, whichever is earlier after it).
   */
  timeOf(preset: ClockPreset): number {
    const noon = this.config.solarNoonHours * 60;
    let minutes: number;
    switch (preset) {
      case 'noon':
        minutes = noon;
        break;
      case 'dawn':
        minutes = this.whenSunAt(this.dawn.sunElevationDegrees, noon - MINUTES_PER_DAY / 2, noon);
        break;
      case 'morning':
        minutes = (this.whenSunAt(this.dawn.sunElevationDegrees, noon - MINUTES_PER_DAY / 2, noon) + noon) / 2;
        break;
      case 'dusk':
        minutes = this.whenSunAt(this.dusk.sunElevationDegrees, noon + MINUTES_PER_DAY / 2, noon);
        break;
      case 'night':
        minutes = Math.min(this.whenSunAt(this.night.sunElevationDegrees, noon + MINUTES_PER_DAY / 2, noon) + 120, 23 * 60);
        break;
    }
    return wrapMinutes(Math.round(minutes / PRESET_ROUNDING_MINUTES) * PRESET_ROUNDING_MINUTES);
  }

  /** Places the sun, the moon and the stars for the clock and the calendar, and weighs the looks. */
  private place(): void {
    const now = this.clock.now();
    const day = dayOfYear(now);
    const sunHour = sunHourAngle(this.minutesValue, this.config.solarNoonHours);
    skyDirection(sunDeclination(day), sunHour, this.latitude, this.sun);
    this.sunElevation = elevationOf(this.sun);
    this.rising = Math.sin(sunHour) < 0;
    this.phaseValue = moonPhase(now);
    skyDirection(moonDeclination(day, this.phaseValue), moonHourAngle(sunHour, this.phaseValue), this.latitude, this.moon);
    this.moonElevation = elevationOf(this.moon);
    this.starTurnValue = starTurn(this.minutesValue, day, this.config.solarNoonHours);
    daylightWeights(
      this.sunElevation,
      this.config.dayFromDegrees,
      this.twilight.sunElevationDegrees,
      this.night.sunElevationDegrees,
      this.weights,
    );
  }

  /**
   * When today, between `from` and `to` (minutes; the sun climbing or sinking
   * steadily between them), the sun stands at `elevationDegrees`: halving
   * the window. The end nearer noon if it never gets there.
   */
  private whenSunAt(elevationDegrees: number, from: number, to: number): number {
    const day = dayOfYear(this.clock.now());
    const declination = sunDeclination(day);
    let far = from;
    let near = to;
    for (let step = 0; step < SEARCH_STEPS; step++) {
      const middle = (far + near) / 2;
      skyDirection(declination, sunHourAngle(middle, this.config.solarNoonHours), this.latitude, this.scratch);
      if (elevationOf(this.scratch) < elevationDegrees) {
        far = middle;
      } else {
        near = middle;
      }
    }
    return (far + near) / 2;
  }
}

function elevationOf(direction: SkyDirection): number {
  return (Math.asin(Math.max(-1, Math.min(1, direction.y))) * 180) / Math.PI;
}
