import { smoothstep } from '../../core/math/scalar';
import { SeededRandom } from '../../core/random/SeededRandom';

/** Lightning strikes only in rain this hard or harder, more often the harder, fully from STORM_FULL_RAIN. */
const STORM_RAIN = 0.7;
const STORM_FULL_RAIN = 0.95;
/** In a full storm a strike comes every this many seconds (at random between them); twice as long in a weaker one. */
const STRIKE_EVERY_SECONDS = [7, 22] as const;
/** Strikes land this near and this far, meters: the nearer, the brighter and the louder. */
const STRIKE_DISTANCE_METERS = [500, 6000] as const;
/**
 * A strike is a few return strokes down the same channel: this many at
 * most, this far apart (seconds, at random between them), each after the
 * first somewhat dimmer. Each flashes up at once and dies away with this
 * time constant, leaving the cloud glowing a little longer.
 */
const MAX_STROKES = 4;
const STROKE_GAP_SECONDS = [0.05, 0.16] as const;
const STROKE_FADE_SECONDS = 0.07;
const GLOW_FADE_SECONDS = 0.3;
const GLOW_SHARE = 0.25;
/** A stroke's light is gone (under 1%) this long after it. */
const STROKE_LASTS_SECONDS = GLOW_FADE_SECONDS * 5;
/** Half the strikes land within this angle (radians) either side of where the camera looks, so bolts are seen. */
const IN_VIEW_ANGLE = 0.9;

/** The strike that began this frame (Thunderstorm.update): the same object, rewritten each strike. */
export interface LightningStrike {
  /** How far off it struck, meters. */
  distanceMeters: number;
  /** Which way (radians round from +z toward +x, like a heading). */
  bearing: number;
  /** How bright its first stroke is, 0..1: the nearer, the brighter. */
  brightness: number;
}

/**
 * Lightning in heavy rain: strikes at random (seeded) intervals, each a
 * few return strokes flashing over half a second or so, near or far. The
 * flash (0..1) lights the sky, the clouds and the world
 * (EnvironmentView.setLightning); a strike's distance tells the thunder
 * when to follow (thunderSound), its bearing where to draw the bolt
 * (LightningView). No strikes in lighter rain. Allocation-free.
 */
export class Thunderstorm {
  private readonly strike: LightningStrike = { distanceMeters: 0, bearing: 0, brightness: 0 };
  /** The current strike's strokes: when each flashes (seconds since the strike began) and how brightly. */
  private readonly strokeAt = new Float64Array(MAX_STROKES);
  private readonly strokeLight = new Float64Array(MAX_STROKES);
  private strokes = 0;
  private sinceStrike = Infinity;
  private untilStrike: number;
  private flashLevel = 0;

  constructor(private readonly random = new SeededRandom(71)) {
    this.untilStrike = this.nextWait(1);
  }

  /** How bright the lightning's flash is now, 0..1. */
  get flash(): number {
    return this.flashLevel;
  }

  /** How long since the last strike began, seconds (Infinity before the first). */
  get secondsSinceStrike(): number {
    return this.sinceStrike;
  }

  /**
   * Runs the storm `deltaSeconds` on in rain `rain` hard (0..1), with the
   * camera looking toward `lookBearing` (radians, like a heading). Returns
   * the strike that began, or null.
   */
  update(deltaSeconds: number, rain: number, lookBearing = 0): Readonly<LightningStrike> | null {
    const storm = smoothstep(STORM_RAIN, STORM_FULL_RAIN, rain);
    let struck: LightningStrike | null = null;
    this.sinceStrike += deltaSeconds;
    if (storm > 0) {
      this.untilStrike -= deltaSeconds;
      if (this.untilStrike <= 0) {
        struck = this.strikeNow(lookBearing);
        this.untilStrike = this.nextWait(storm);
      }
    }
    this.flashLevel = this.lightAt(this.sinceStrike);
    return struck;
  }

  private strikeNow(lookBearing: number): LightningStrike {
    const random = this.random;
    const [near, far] = STRIKE_DISTANCE_METERS;
    // Nearer strikes are rarer: the ground within a ring grows with its radius.
    const distance = near + (far - near) * Math.sqrt(random.next());
    const strike = this.strike;
    strike.distanceMeters = distance;
    strike.bearing = random.next() < 0.5 ? lookBearing + random.range(-IN_VIEW_ANGLE, IN_VIEW_ANGLE) : random.range(-Math.PI, Math.PI);
    strike.brightness = Math.min(1, Math.max(0.25, 1.15 - distance / far));
    this.strokes = random.int(1, MAX_STROKES);
    let at = 0;
    for (let stroke = 0; stroke < this.strokes; stroke++) {
      this.strokeAt[stroke] = at;
      this.strokeLight[stroke] = strike.brightness * (stroke === 0 ? 1 : random.range(0.45, 0.9));
      at += random.range(STROKE_GAP_SECONDS[0], STROKE_GAP_SECONDS[1]);
    }
    this.sinceStrike = 0;
    return strike;
  }

  /** The strokes' light `seconds` after the strike began: each a sharp flash and a slower glow. */
  private lightAt(seconds: number): number {
    if (this.strokes === 0 || seconds > this.strokeAt[this.strokes - 1]! + STROKE_LASTS_SECONDS) {
      return 0;
    }
    let light = 0;
    for (let stroke = 0; stroke < this.strokes; stroke++) {
      const since = seconds - this.strokeAt[stroke]!;
      if (since >= 0) {
        light +=
          this.strokeLight[stroke]! *
          ((1 - GLOW_SHARE) * Math.exp(-since / STROKE_FADE_SECONDS) + GLOW_SHARE * Math.exp(-since / GLOW_FADE_SECONDS));
      }
    }
    return Math.min(1, light);
  }

  /** Seconds to the next strike in a storm `storm` strong (0..1): the weaker, the longer. */
  private nextWait(storm: number): number {
    return this.random.range(STRIKE_EVERY_SECONDS[0], STRIKE_EVERY_SECONDS[1]) / (0.5 + 0.5 * storm);
  }
}
