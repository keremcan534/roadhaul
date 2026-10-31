import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import type { GameConfig } from '../../data/config/GameConfig';
import type { Season } from '../../data/definitions/Season';
import type { Fraction } from '../../data/units';
import { auroraTonight, NIGHT_FROM, type SkyWonder } from '../../domain/sky/skyWonders';
import type { GameEvents } from '../GameEvents';

/** The northern lights come and go over this long, seconds. */
const AURORA_FADE_SECONDS = 20;
/** A rainbow counts at most once in this long, seconds: the clouds passing over the sun hide and show it. */
const RAINBOW_COUNT_SECONDS = 600;

/**
 * The sky's wonders (GameConfig.skyWonders). Each night, as it falls, it
 * draws whether the northern lights come out (more often in winter); they
 * fade in with the dark and out with the dawn (`aurora`, which the sky
 * draws where it is clear). Shooting stars and rainbows the presentation
 * makes itself. What the player sees, the entry point tells it (`observe`):
 * each wonder counts once as it comes into view, a shooting star at most
 * once every few minutes, and is announced (`SkyWonderSighted`), which the
 * goals count. Nothing here is saved: a night's draw is made again as the
 * next one falls.
 */
export class SkyWonderService {
  private tonight = false;
  private wasNight = false;
  private strength = 0;
  private forced = false;
  private readonly showing: Record<SkyWonder, boolean> = { aurora: false, meteor: false, rainbow: false };
  private sinceMeteor = Number.POSITIVE_INFINITY;
  private sinceRainbow = Number.POSITIVE_INFINITY;
  /** The northern lights counted tonight: once a night, however often the clouds hide them. */
  private auroraCounted = false;

  constructor(
    private readonly config: GameConfig['skyWonders'],
    private readonly sky: { readonly weights: { readonly night: number } },
    private readonly season: { readonly season: Season },
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

  /** Moves `dt` seconds on: a night falling draws its lights; they fade toward the night's. Allocation-free. */
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
  }

  /**
   * Whether `kind` is on the sky now (as drawn), and whether the player is
   * watching it (on the road, not paused or in the panel). It counts as it is
   * first watched on the sky, announced once: looking away and back (a
   * pause) does not count it again, only its leaving the sky and coming
   * back; and then the northern lights once a night, a rainbow at most every
   * ten minutes and a shooting star every few. Allocation-free when nothing
   * is announced.
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
    }
  }
}
