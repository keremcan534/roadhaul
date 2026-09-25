import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { SeededRandom } from '../../core/random/SeededRandom';
import type { GameConfig } from '../../data/config/GameConfig';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { WeatherDefinition } from '../../data/definitions/WeatherDefinition';
import type { DrivingService } from '../driving/DrivingService';
import type { GameEvents } from '../GameEvents';
import type { TrafficService } from '../traffic/TrafficService';

/** Seeds the weather's schedule. */
const WEATHER_SEED = 38;
/** During a transition the truck's grip is handed on in steps this small (not every fixed step). */
const GRIP_STEP = 0.01;
/** The time of day changes traffic's speed in steps this small. */
const TRAFFIC_STEP = 0.005;

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
 * `current` and `blend` (and the blended `rain` and `lamps`) to draw it,
 * over the time of day's look. Call update() every fixed step.
 */
export class WeatherService {
  private currentWeather: WeatherDefinition;
  private previousWeather: WeatherDefinition;
  private blendValue = 1;
  private remainingSeconds: number;
  private readonly random = new SeededRandom(WEATHER_SEED);
  private appliedGrip = Number.NaN;
  private appliedTraffic = Number.NaN;
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
  ) {
    this.currentWeather = content.weather.get(config.initialWeatherId);
    this.previousWeather = this.currentWeather;
    this.remainingSeconds = this.spellLength(this.currentWeather);
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

  /** The truck's grip now, as a factor (blended during a transition). */
  get gripFactor(): number {
    return mix(this.previousWeather.gripFactor, this.currentWeather.gripFactor, this.blendValue);
  }

  /** How hard it rains now, 0..1 (blended during a transition). */
  get rain(): number {
    return mix(this.previousWeather.look.rain, this.currentWeather.look.rain, this.blendValue);
  }

  /** How brightly headlights and lamps shine for the weather (rain darkens the day), 0..1, blended during a transition. */
  get lamps(): number {
    return mix(this.previousWeather.look.lamps, this.currentWeather.look.lamps, this.blendValue);
  }

  /** Advances the schedule and the transition by `dt` seconds. Allocation-free, except when the weather turns. */
  update(dt: number): void {
    if (this.blendValue < 1) {
      this.blendValue = Math.min(1, this.blendValue + dt / this.config.transitionSeconds);
      this.apply();
    } else if (this.daylight !== null) {
      this.applyTraffic();
    }
    if (!this.config.changes) {
      return;
    }
    this.remainingSeconds -= dt;
    if (this.remainingSeconds <= 0) {
      this.turnTo(this.pickNext());
    }
  }

  /** Turns the weather to `weatherId` straight away (no transition). For tests and the debug switch. */
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

  /** Another weather than the current one, one it may turn into (the day's order), by weight. */
  private pickNext(): WeatherDefinition {
    const allowed = this.currentWeather.next;
    const choices = this.content.weather.all.filter(
      (weather) => weather !== this.currentWeather && (allowed === undefined || allowed.includes(weather.id)),
    );
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
