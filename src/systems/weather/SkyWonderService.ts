import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import type { Clock } from '../../core/time/Clock';
import type { GameConfig } from '../../data/config/GameConfig';
import type { Season } from '../../data/definitions/Season';
import type { Fraction } from '../../data/units';
import { localDay } from '../../domain/rewards/dailyReward';
import {
  createEclipseState,
  eclipseAt,
  eclipseCentredAt,
  eclipseOnDay,
  type EclipseKind,
  type EclipseOfDay,
  type EclipseSky,
  type EclipseState,
} from '../../domain/sky/eclipses';
import { auroraTonight, NIGHT_FROM, type SkyWonder } from '../../domain/sky/skyWonders';
import type { GameEvents } from '../GameEvents';

/**
 * What the eclipses are timed by: the calendar's day (the clock, the phone's time zone), and the region's sky
 * (its latitude, when the sun stands highest: GameConfig.timeOfDay).
 */
export interface EclipseCalendar extends EclipseSky {
  readonly clock: Clock;
  /** Minutes the phone's time zone runs ahead of UTC. */
  readonly offsetMinutes: number;
}

/** The northern lights come and go over this long, seconds. */
const AURORA_FADE_SECONDS = 20;
/** A rainbow counts at most once in this long, seconds: the clouds passing over the sun hide and show it. */
const RAINBOW_COUNT_SECONDS = 600;

/**
 * The sky's wonders (GameConfig.skyWonders). Each night, as it falls, it
 * draws whether the northern lights come out (more often in winter); they
 * fade in with the dark and out with the dawn (`aurora`, which the sky
 * draws where it is clear). On the calendar's days of some new and full
 * moons an eclipse comes at its hour of the game's clock (domain/sky/
 * eclipses): `eclipse` says how it stands, for the sky to draw and darken,
 * and its beginning is announced (`EclipseBegan`). Shooting stars and
 * rainbows the presentation makes itself. What the player sees, the entry
 * point tells it (`observe`): each wonder counts once as it comes into
 * view, a shooting star at most once every few minutes, an eclipse once
 * each time it comes round, and is announced (`SkyWonderSighted`), which
 * the goals count. Nothing here is saved: a night's draw is made again as
 * the next one falls, and the eclipses follow the calendar.
 */
export class SkyWonderService {
  private tonight = false;
  private wasNight = false;
  private strength = 0;
  private forced = false;
  private readonly showing: Record<SkyWonder, boolean> = {
    aurora: false,
    meteor: false,
    rainbow: false,
    solarEclipse: false,
    lunarEclipse: false,
  };
  private sinceMeteor = Number.POSITIVE_INFINITY;
  private sinceRainbow = Number.POSITIVE_INFINITY;
  /** The northern lights counted tonight: once a night, however often the clouds hide them. */
  private auroraCounted = false;
  /** The eclipse under way, as it stands now. Updated in place. */
  private readonly eclipseNow = createEclipseState();
  /** The calendar's day the eclipse was planned for, and its eclipse (null: none that day). */
  private plannedDay = Number.NaN;
  private plan: EclipseOfDay | null = null;
  /** `?sky=solar|lunar`: that eclipse every day, at the hour asked. */
  private forcedPlan: EclipseOfDay | null = null;
  /** The eclipse under way counted: once each time it comes round. */
  private eclipseCounted = false;

  constructor(
    private readonly config: GameConfig['skyWonders'],
    /** The time of day (TimeOfDayService): the night falling, the clock, and the moon an eclipse brings to full. */
    private readonly sky: {
      readonly weights: { readonly night: number };
      readonly minutes: number;
      drawMoonToPhase(phase: number, weight: number): void;
    },
    private readonly season: { readonly season: Season },
    private readonly calendar: EclipseCalendar,
    /** Uniform in [0, 1): a seeded generator in tests. */
    private readonly random: () => number,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {}

  /** How strongly the northern lights shine now, 0..1, before the clouds and the light of the sky. */
  get aurora(): Fraction {
    return this.strength;
  }

  /** The northern lights every night (`?sky=aurora`, for a look), or by chance again. */
  forceAurora(on: boolean): void {
    this.forced = on;
    this.tonight = this.tonight || on;
  }

  /** The eclipse on the sky now: its kind null for none. */
  get eclipse(): Readonly<EclipseState> {
    return this.eclipseNow;
  }

  /**
   * An eclipse of `kind` every day, its middle at `centreMinutes` of the game's clock (`?sky=solar|lunar`, for
   * a look), or the calendar's again (null).
   */
  forceEclipse(kind: EclipseKind | null, centreMinutes = 0): void {
    this.forcedPlan = kind === null ? null : eclipseCentredAt(kind, centreMinutes, this.config.eclipses);
    this.plannedDay = Number.NaN;
  }

  /** The eclipse on the calendar's day `daysAhead` from today (0 today, 1 tomorrow), or null: for the news. */
  eclipseOn(daysAhead: number): EclipseOfDay | null {
    if (this.forcedPlan !== null) {
      return this.forcedPlan;
    }
    const { clock, offsetMinutes } = this.calendar;
    return eclipseOnDay(localDay(clock.now(), offsetMinutes) + daysAhead, offsetMinutes, this.config.eclipses, this.calendar);
  }

  /**
   * Moves `dt` seconds on: a night falling draws its lights; they fade toward the night's. An eclipse due on
   * the game's clock today stands as its time says, announced as it begins. Allocation-free but on a new day.
   */
  update(dt: number): void {
    const night = this.sky.weights.night;
    const isNight = night >= NIGHT_FROM;
    if (isNight && !this.wasNight) {
      this.auroraCounted = false;
      this.tonight = this.forced || auroraTonight(this.random(), this.season.season, this.config.auroraChance);
      if (this.tonight) {
        this.logger.info('The northern lights are out tonight.');
      }
    }
    this.wasNight = isNight;
    const target = this.tonight ? Math.min(1, Math.max(0, (night - 0.3) / 0.6)) : 0;
    this.strength += (target - this.strength) * Math.min(1, dt / AURORA_FADE_SECONDS);
    this.sinceMeteor += dt;
    this.sinceRainbow += dt;
    this.updateEclipse();
  }

  /**
   * Whether `kind` is on the sky now (as drawn), and whether the player is
   * watching it (on the road, not paused or in the panel). It counts as it is
   * first watched on the sky, announced once: looking away and back (a
   * pause) does not count it again, only its leaving the sky and coming
   * back; and then the northern lights once a night, a rainbow at most every
   * ten minutes, a shooting star every few and an eclipse once each time it
   * comes round. Allocation-free when nothing is announced.
   */
  observe(kind: SkyWonder, onSky: boolean, watching: boolean): void {
    if (!onSky) {
      this.showing[kind] = false;
      return;
    }
    if (!watching || this.showing[kind]) {
      return;
    }
    this.showing[kind] = true;
    if (!this.mayCount(kind)) {
      return;
    }
    this.logger.info(`Sky wonder seen: ${kind}.`);
    this.events.emit('SkyWonderSighted', { kind });
  }

  /** Today's eclipse as the game's clock has it now; its beginning announced. */
  private updateEclipse(): void {
    const { clock, offsetMinutes } = this.calendar;
    const day = localDay(clock.now(), offsetMinutes);
    if (day !== this.plannedDay) {
      this.plannedDay = day;
      this.plan = this.forcedPlan ?? eclipseOnDay(day, offsetMinutes, this.config.eclipses, this.calendar);
    }
    const plan = this.plan;
    const eclipse = this.eclipseNow;
    const before = eclipse.kind;
    eclipseAt(plan === null ? null : plan.kind, plan === null ? 0 : plan.centreMinutes, this.sky.minutes, this.config.eclipses, eclipse);
    // The earth's shadow falls opposite the sun: the eclipsed moon stands exactly full.
    this.sky.drawMoonToPhase(0.5, eclipse.fullMoon);
    if (plan !== null && eclipse.kind !== null && before === null) {
      this.eclipseCounted = false;
      this.logger.info(`An eclipse of the ${eclipse.kind === 'solar' ? 'sun' : 'moon'} has begun.`);
      this.events.emit('EclipseBegan', { kind: eclipse.kind, totalityMinutes: plan.totalityMinutes });
    }
  }

  /** Whether a sighting of `kind` counts now, and if so its count is taken. */
  private mayCount(kind: SkyWonder): boolean {
    switch (kind) {
      case 'aurora':
        if (this.auroraCounted) {
          return false;
        }
        this.auroraCounted = true;
        return true;
      case 'rainbow':
        if (this.sinceRainbow < RAINBOW_COUNT_SECONDS) {
          return false;
        }
        this.sinceRainbow = 0;
        return true;
      case 'meteor':
        if (this.sinceMeteor < this.config.meteorCountSeconds) {
          return false;
        }
        this.sinceMeteor = 0;
        return true;
      case 'solarEclipse':
      case 'lunarEclipse':
        if (this.eclipseCounted) {
          return false;
        }
        this.eclipseCounted = true;
        return true;
    }
  }
}
