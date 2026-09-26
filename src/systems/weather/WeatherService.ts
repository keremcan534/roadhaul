import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { SeededRandom } from '../../core/random/SeededRandom';
import type { GameConfig } from '../../data/config/GameConfig';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { WeatherDefinition } from '../../data/definitions/WeatherDefinition';
import type { DrivingService } from '../driving/DrivingService';
import type { GameEvents } from '../GameEvents';
import type { TrafficService } from '../traffic/TrafficService';
import type { SeasonSource } from './SeasonService';

/** Seeds the weather's schedule. */
const WEATHER_SEED = 38;
/** During a transition the truck's grip is handed on in steps this small (not every fixed step). */
const GRIP_STEP = 0.01;
/** The time of day changes traffic's speed in steps this small. */
const TRAFFIC_STEP = 0.005;
/**
 * The roads wet through this many seconds after hard rain starts (lighter
 * rain wets them less), and dry off this many seconds after it stops.
 */
const WETTING_SECONDS = 20;
const DRYING_SECONDS = 180;
/** Falling snow leaves the roads this wet, as slush. */
const SLUSH_WETNESS = 0.5;
/**
 * Snow covers the ground this many seconds after it starts to fall hard,
 * and melts this many seconds after it stops (down to the season's own).
 */
const SNOWING_SECONDS = 40;
const MELTING_SECONDS = 600;

/** How the time of day changes traffic's speed (TimeOfDayService). */
export interface DaylightTraffic {
  readonly trafficSpeedFactor: number;
}

/**
 * The weather (spec §38, the WeatherManager). It runs a seeded schedule:
 * each weather lasts a while, then turns into another it may turn into,
 * chosen by weight, over `transitionSeconds`. Meanwhile it applies the
 * effects, blended: the truck's grip (a DrivingService performance
 * modifier) and how fast traffic drives, with the time of day's slower
 * traffic in the dark (`daylight`) on top. Presentation reads `previous`,
 * `current` and `blend` (and the blended `rain` and `lamps`, and how wet
 * the roads are, and how much snow lies) to draw it, over the time of
 * day's look. It follows the season (`season`): a weather comes only in
 * the seasons it names (snow in winter, rain in the others). The player
 * may hold it as one weather (hold(), Settings), and let it change again.
 * Call update() every fixed step.
 */
export class WeatherService {
  private currentWeather: WeatherDefinition;
  private previousWeather: WeatherDefinition;
  private blendValue = 1;
  private remainingSeconds: number;
  private readonly random = new SeededRandom(WEATHER_SEED);
  private appliedGrip = Number.NaN;
  private appliedTraffic = Number.NaN;
  private wetnessValue: number;
  private snowCoverValue: number;
  /** Whether the schedule runs: the config's to begin with, then the player's (hold). */
  private changing: boolean;
  /** Reused for every grip update. */
  private readonly modifier = { torqueFactor: 1, brakeFactor: 1, gripFactor: 1, stabilityFactor: 1 };

  constructor(
    private readonly content: ContentCatalog,
    private readonly driving: DrivingService,
    private readonly traffic: TrafficService,
    private readonly events: EventBus<GameEvents>,
    private readonly config: GameConfig['weather'],
    private readonly logger: Logger,
    private readonly daylight: DaylightTraffic | null = null,
    private readonly season: SeasonSource | null = null,
  ) {
    this.currentWeather = content.weather.get(config.initialWeatherId);
    this.previousWeather = this.currentWeather;
    this.remainingSeconds = this.spellLength(this.currentWeather);
    this.wetnessValue = Math.max(this.currentWeather.look.rain, SLUSH_WETNESS * (this.currentWeather.snowfall ?? 0));
    this.snowCoverValue = Math.max(this.currentWeather.snowfall ?? 0, season?.groundSnow ?? 0);
    this.changing = config.changes;
    this.apply();
  }

  /** The weather now (or turning into, during a transition). */
  get current(): WeatherDefinition {
    return this.currentWeather;
  }

  /** The weather it is turning from; the same as `current` once the transition is over. */
  get previous(): WeatherDefinition {
    return this.previousWeather;
  }

  /** How far the transition from `previous` to `current` is, 0..1. */
  get blend(): number {
    return this.blendValue;
  }

  /** The weather it keeps (hold(), or the config's that it may not change), or null while it changes by itself. */
  get held(): string | null {
    return this.changing ? null : this.currentWeather.id;
  }

  /** The truck's grip now, as a factor (blended during a transition). */
  get gripFactor(): number {
    return mix(this.previousWeather.gripFactor, this.currentWeather.gripFactor, this.blendValue);
  }

  /** How hard it rains now, 0..1 (blended during a transition). */
  get rain(): number {
    return mix(this.previousWeather.look.rain, this.currentWeather.look.rain, this.blendValue);
  }

  /** How hard it snows now, 0..1 (blended during a transition). */
  get snow(): number {
    return mix(this.previousWeather.snowfall ?? 0, this.currentWeather.snowfall ?? 0, this.blendValue);
  }

  /**
   * How much of the ground snow covers, 0..1: it settles soon after snow
   * starts to fall (as much as it falls hard) and melts slowly after it
   * stops, down to what the season keeps (some in winter, none else).
   */
  get snowCover(): number {
    return this.snowCoverValue;
  }

  /** How brightly headlights and lamps shine for the weather (rain darkens the day), 0..1, blended during a transition. */
  get lamps(): number {
    return mix(this.previousWeather.look.lamps, this.currentWeather.look.lamps, this.blendValue);
  }

  /**
   * How wet the roads are, 0..1: they wet through soon after the rain starts
   * (as wet as it rains hard) and dry off slowly after it stops, so they
   * shine and throw spray a while after the rain. A game that starts in the
   * rain starts wet.
   */
  get wetness(): number {
    return this.wetnessValue;
  }

  /**
   * Advances the schedule, the transition and the roads' wetness by `dt`
   * seconds. Allocation-free, except when the weather turns.
   */
  update(dt: number): void {
    if (this.blendValue < 1) {
      this.blendValue = Math.min(1, this.blendValue + dt / this.config.transitionSeconds);
      this.apply();
    } else if (this.daylight !== null) {
      this.applyTraffic();
    }
    const snow = this.snow;
    const wet = Math.max(this.rain, SLUSH_WETNESS * snow);
    this.wetnessValue =
      this.wetnessValue < wet
        ? Math.min(wet, this.wetnessValue + dt / WETTING_SECONDS)
        : Math.max(wet, this.wetnessValue - dt / DRYING_SECONDS);
    const cover = Math.max(snow, this.season?.groundSnow ?? 0);
    this.snowCoverValue =
      this.snowCoverValue < cover
        ? Math.min(cover, this.snowCoverValue + dt / SNOWING_SECONDS)
        : Math.max(cover, this.snowCoverValue - dt / MELTING_SECONDS);
    if (!this.changing) {
      return;
    }
    this.remainingSeconds -= dt;
    // Out of season (the season has turned): it turns now, to what the season brings.
    if (this.remainingSeconds <= 0 || (this.blendValue === 1 && !this.inSeason(this.currentWeather))) {
      const next = this.pickNext();
      if (next !== this.currentWeather) {
        this.turnTo(next);
      } else {
        this.remainingSeconds = this.spellLength(next);
      }
    }
  }

  /**
   * Turns the weather to `weatherId` straight away (no transition); the
   * roads wet or dry from there. For tests and the debug switch.
   */
  set(weatherId: string): void {
    const next = this.content.weather.get(weatherId);
    const previous = this.currentWeather;
    this.previousWeather = next;
    this.currentWeather = next;
    this.blendValue = 1;
    this.remainingSeconds = this.spellLength(next);
    this.apply();
    if (previous !== next) {
      this.events.emit('WeatherChanged', { weatherId: next.id, previousId: previous.id });
    }
  }

  /**
   * Keeps the weather as `weatherId` from now on: it turns to it straight
   * away (set), the roads wetting or drying from there, and turns no more.
   * Null lets it change by itself again: the weather now lasts a spell, then
   * turns as it would.
   */
  hold(weatherId: string | null): void {
    if (weatherId === null) {
      if (!this.changing) {
        this.changing = true;
        this.remainingSeconds = this.spellLength(this.currentWeather);
      }
      return;
    }
    this.changing = false;
    this.set(weatherId);
  }

  dispose(): void {
    this.modifier.gripFactor = 1;
    this.driving.setPerformanceModifier('weather', this.modifier);
  }

  private turnTo(next: WeatherDefinition): void {
    this.previousWeather = this.currentWeather;
    this.currentWeather = next;
    this.blendValue = 0;
    this.remainingSeconds = this.config.transitionSeconds + this.spellLength(next);
    this.apply();
    this.logger.info(`The weather turns from ${this.previousWeather.id} to ${next.id}.`);
    this.events.emit('WeatherChanged', { weatherId: next.id, previousId: this.previousWeather.id });
  }

  /**
   * Another weather than the current one, in season, one it may turn into
   * (the day's order), by weight; any other in season when none of those is.
   */
  private pickNext(): WeatherDefinition {
    const allowed = this.currentWeather.next;
    const others = this.content.weather.all.filter((weather) => weather !== this.currentWeather && this.inSeason(weather));
    const successors = others.filter((weather) => allowed === undefined || allowed.includes(weather.id));
    const choices = successors.length > 0 ? successors : others;
    if (choices.length === 0) {
      return this.currentWeather;
    }
    const total = choices.reduce((sum, weather) => sum + weather.weight, 0);
    let pick = this.random.next() * total;
    for (const weather of choices) {
      pick -= weather.weight;
      if (pick < 0) {
        return weather;
      }
    }
    return choices[choices.length - 1]!;
  }

  /** Whether `weather` may come in the season now (any, without a season to follow). */
  private inSeason(weather: WeatherDefinition): boolean {
    return this.season === null || weather.seasons === undefined || weather.seasons.includes(this.season.season);
  }

  private spellLength(weather: WeatherDefinition): number {
    return this.random.range(weather.minSeconds, weather.maxSeconds);
  }

  /** Hands the blended effects to the services they change, when they change (the grip in small steps). */
  private apply(): void {
    const grip = this.gripFactor;
    const settled = this.blendValue === 1 && grip !== this.appliedGrip;
    if (settled || !(Math.abs(grip - this.appliedGrip) < GRIP_STEP)) {
      this.appliedGrip = grip;
      this.modifier.gripFactor = grip;
      this.driving.setPerformanceModifier('weather', this.modifier);
    }
    this.applyTraffic();
  }

  /**
   * Hands traffic its speed for the weather and the time of day when it
   * changes: the time's share in steps of TRAFFIC_STEP, so the slow turn of
   * the day does not change it every fixed step.
   */
  private applyTraffic(): void {
    const weather = mix(this.previousWeather.trafficSpeedFactor, this.currentWeather.trafficSpeedFactor, this.blendValue);
    const daylight = this.daylight === null ? 1 : Math.round(this.daylight.trafficSpeedFactor / TRAFFIC_STEP) * TRAFFIC_STEP;
    const traffic = weather * daylight;
    if (traffic !== this.appliedTraffic) {
      this.appliedTraffic = traffic;
      this.traffic.setSpeedFactor(traffic);
    }
  }
}

function mix(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}
