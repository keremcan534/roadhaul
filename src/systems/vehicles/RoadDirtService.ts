import { clamp } from '../../core/math/scalar';
import type { EventBus } from '../../core/events/EventBus';
import type { Fraction } from '../../data/units';
import { dirtLevel, dirtThrownUp, type DirtLevel, type RoadDirtConfig } from '../../domain/vehicles/roadDirt';
import type { GameEvents } from '../GameEvents';

/** What the road is like for the truck the player drives now (wired from DrivingService and WeatherService). */
export interface RoadDirtConditions {
  /** On the road in the company's truck: not in the menus, nor racing the club's car. */
  readonly driving: boolean;
  /** How fast it goes, m/s (either way). */
  readonly speedMetersPerSecond: number;
  /** How wet the road is (WeatherService.wetness). */
  readonly wetness: Fraction;
  /** Snow falling. */
  readonly snowy: boolean;
  /** Off the road. */
  readonly offRoad: boolean;
}

/**
 * The road dirt on the truck the player drives (GameConfig.roadDirt): the
 * metres it drives throw dirt up on it, more on a wet road, in the snow's
 * slush and off the road, until it is caked. The truck wash scrubs it off
 * (`wash`, by the share the player scrubbed clean). Only its look: the
 * truck's view shows it. GarageService keeps each truck's dirt as it keeps
 * its fuel and damage: this holds the active one's, restored as it takes
 * the wheel. Call update() every fixed step. Allocation-free.
 */
export class RoadDirtService {
  private dirtValue = 0;
  private levelValue: DirtLevel = 'clean';
  private readonly scratch = { wetness: 0, snowy: false, offRoad: false };

  constructor(
    private readonly config: RoadDirtConfig,
    private readonly conditions: RoadDirtConditions,
    private readonly events: EventBus<GameEvents>,
  ) {}

  /** How dirty the truck is, 0 clean to 1 caked. */
  get dirt(): Fraction {
    return this.dirtValue;
  }

  /** How it looks for it. */
  get level(): DirtLevel {
    return this.levelValue;
  }

  /** The active truck's dirt, as the garage kept it. */
  restore(dirt: Fraction): void {
    this.dirtValue = clamp(Number.isFinite(dirt) ? dirt : 0, 0, 1);
    this.levelValue = dirtLevel(this.dirtValue);
  }

  /** Moves `dt` seconds on: what the truck drives throws dirt up on it. */
  update(dt: number): void {
    const conditions = this.conditions;
    if (!conditions.driving || this.dirtValue >= 1) {
      return;
    }
    const scratch = this.scratch;
    scratch.wetness = conditions.wetness;
    scratch.snowy = conditions.snowy;
    scratch.offRoad = conditions.offRoad;
    const meters = Math.abs(conditions.speedMetersPerSecond) * Math.max(0, dt);
    if (meters <= 0) {
      return;
    }
    this.set(Math.min(1, this.dirtValue + dirtThrownUp(meters, scratch, this.config)));
  }

  /** The truck wash: `share` of the dirt scrubbed off (all of it for 1). */
  wash(share: Fraction): void {
    const before = this.dirtValue;
    this.set(this.dirtValue * (1 - clamp(share, 0, 1)));
    if (this.dirtValue < before) {
      this.events.emit('TruckCleaned', { dirt: this.dirtValue });
    }
  }

  private set(dirt: Fraction): void {
    this.dirtValue = dirt;
    const level = dirtLevel(dirt);
    if (level !== this.levelValue) {
      this.levelValue = level;
      this.events.emit('TruckDirtChanged', { level });
    }
  }
}
