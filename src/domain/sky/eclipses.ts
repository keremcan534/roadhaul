import { clamp, degreesToRadians, smoothstep } from '../../core/math/scalar';
import { SeededRandom } from '../../core/random/SeededRandom';
import { MINUTES_PER_DAY, wrapMinutes } from '../../core/time/dayTime';
import type { GameConfig } from '../../data/config/GameConfig';
import type { Fraction } from '../../data/units';
import { mixColor, type SkyLook } from './skyLook';
import { dayOfYear, hourAngleAt, lunationAt, moonDeclination, newMoonMs, sunDeclination, SYNODIC_MONTH_MS } from './solar';

/**
 * The sky's rarest wonders: a total eclipse of the sun, the moon sliding
 * over it at a new moon until only its corona shines round a black disc,
 * and of the moon, the earth's shadow creeping over the full moon until it
 * glows copper. They come on the calendar's days of the real new and full
 * moons (the sky's own moon is new or full then too), some of them, each at
 * its hour of the game's clock: when the sun (or the full moon) stands
 * low, morning or evening, so that it hangs over the road ahead, where a
 * driver looks, not overhead. Their geometry is the real one's in shape (the discs and the
 * shadow's sizes), not in time: the phases are shortened and totality
 * stretched, so a player sees one through in a few minutes.
 */

/** The two kinds: of the sun, of the moon. */
export const ECLIPSE_KINDS = ['solar', 'lunar'] as const;
export type EclipseKind = (typeof ECLIPSE_KINDS)[number];

/** How eclipses come and how long they last on the game's clock. */
export type EclipseConfig = GameConfig['skyWonders']['eclipses'];
/** Where they are seen from: the region's latitude, and when the sun stands highest on the game's clock. */
export type EclipseSky = Pick<GameConfig['timeOfDay'], 'latitudeDegrees' | 'solarNoonHours'>;

/** A day's eclipse: which, and when on the game's clock (minutes after midnight). */
export interface EclipseOfDay {
  readonly kind: EclipseKind;
  /** The middle of totality. */
  readonly centreMinutes: number;
  /** Totality begins: what the news and the toasts tell. */
  readonly totalityMinutes: number;
}

/** An eclipse as it stands on the sky now (eclipseAt). Writable, so per-frame code reuses one. */
export interface EclipseState {
  /** The eclipse under way, or null for none. */
  kind: EclipseKind | null;
  /**
   * Where the covering disc's middle stands from the covered one's, along
   * its path, in the covered one's radii: the moon's from the sun's
   * (solar), the earth's full shadow's from the moon's (lunar). Negative
   * while it comes on, positive as it goes.
   */
  offset: number;
  /** The share of the covered disc hidden: the sun's by the moon, the moon's in the earth's full shadow. */
  cover: Fraction;
  /** The share of the moon's face in the earth's half shadow or deeper (lunar; 0 for a solar eclipse). */
  penumbra: Fraction;
  /** 1 while the covered disc is wholly hidden, eased in over the last of it and out over the first. */
  totality: Fraction;
  /**
   * How far the moon is drawn to stand exactly full (opposite the sun, where the earth's shadow falls) for an
   * eclipse of it: from none at its first touch to all of it as its half shadow deepens. 0 for a solar one.
   */
  fullMoon: Fraction;
}

/** The moon's radius in the sun's (a little bigger, so its eclipses are total). */
export const MOON_OVER_SUN = 1.08;
/** The earth's full shadow's radius and its half shadow's, where the moon passes, in the moon's radii. */
export const UMBRA_RADIUS = 2.7;
export const PENUMBRA_RADIUS = 4.6;
/** The moon's path passes this far from the middle of the earth's shadow, in its radii: its one side darker. */
export const LUNAR_PATH_MISS = 0.35;
/**
 * At an eclipse's middle the sun (or the full moon) stands between these
 * heights, degrees, the morning's or the evening's side drawn: low enough
 * for a driver to see it ahead, high enough to stay up through the eclipse
 * (the moon's longer one rises or sets in its half shadow at most).
 */
const SOLAR_HEIGHT_DEGREES = [10, 16] as const;
const LUNAR_HEIGHT_DEGREES = [12, 17] as const;
const ROUND_MINUTES = 5;
/**
 * The calendar's moon on a full moon's day is as much as a fortieth of a
 * month from full (and a few degrees from where the earth's shadow falls):
 * through this share of the half shadow's first minutes the eclipse draws
 * it to stand exactly full, while nothing yet shows of the shadow.
 */
const FULL_MOON_PULL_SHARE = 0.8;
/** Totality eases in over the last of the disc being hidden: from this share of it. */
const TOTALITY_FROM = 0.985;
/**
 * How dark a solar eclipse makes the day by the share of the sun hidden:
 * little until half of it is, a deep twilight at totality (DAYLIGHT_LEFT
 * of the sun's light, SKYLIGHT_LEFT of the sky's). The sky turns deep blue
 * overhead with a sunset's glow all round the horizon, the light cools and
 * greys, the stars come out where it is clear and the lamps light up.
 */
const DARKENS_FROM = 0.5;
const DAYLIGHT_LEFT = 0.015;
const SKYLIGHT_LEFT = 0.2;
const ECLIPSE_ZENITH = 0x141c3f;
const ECLIPSE_HORIZON = 0xa8714d;
const ECLIPSE_LIGHT = 0xb7c0dc;
const ECLIPSE_STARS = 0.65;
const ECLIPSE_LAMPS = 0.9;
const ECLIPSE_BLOOM = 0.35;
/** The moon's light left in the earth's full shadow (its copper glow), and dimmed by its half shadow. */
const MOONLIGHT_IN_UMBRA = 0.05;
const PENUMBRA_DIMMING = 0.25;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** No eclipse under way: a state to write into. */
export function createEclipseState(): EclipseState {
  return { kind: null, offset: 0, cover: 0, penumbra: 0, totality: 0, fullMoon: 0 };
}

/**
 * The eclipse on the calendar's day `day` (localDay, the phone
 * `offsetMinutes` ahead of UTC), or null: a solar one on the day of a new
 * moon its lunation draws one for (`solarChance`), a lunar one on the day
 * of a full moon (`lunarChance`). Its middle is drawn too: in the morning
 * or the evening, when the sun (or the full moon) stands low over the
 * region (`sky`).
 */
export function eclipseOnDay(day: number, offsetMinutes: number, config: EclipseConfig, sky: EclipseSky): EclipseOfDay | null {
  const startMs = day * DAY_MS - offsetMinutes * MINUTE_MS;
  const endMs = startMs + DAY_MS;
  // A day holds one new moon or one full moon at most: the lunation's under way at its start, or the next's.
  const first = lunationAt(startMs);
  for (let lunation = first; lunation <= first + 1; lunation++) {
    const newMoon = newMoonMs(lunation);
    const fullMoon = newMoon + SYNODIC_MONTH_MS / 2;
    if (newMoon >= startMs && newMoon < endMs) {
      return drawEclipse('solar', lunation, newMoon, config, sky);
    }
    if (fullMoon >= startMs && fullMoon < endMs) {
      return drawEclipse('lunar', lunation, fullMoon, config, sky);
    }
  }
  return null;
}

/** A `kind` eclipse with its middle at `centreMinutes` of the game's clock (`?sky=solar|lunar`, for a look). */
export function eclipseCentredAt(kind: EclipseKind, centreMinutes: number, config: EclipseConfig): EclipseOfDay {
  return eclipseOfDay(kind, centreMinutes, config);
}

/**
 * The eclipse `kind` with its middle at `centreMinutes` as it stands at
 * `minutes` on the game's clock, into `out` (its kind null outside it).
 * Allocation-free.
 */
export function eclipseAt(
  kind: EclipseKind | null,
  centreMinutes: number,
  minutes: number,
  config: EclipseConfig,
  out: EclipseState,
): EclipseState {
  out.kind = null;
  out.offset = 0;
  out.cover = 0;
  out.penumbra = 0;
  out.totality = 0;
  out.fullMoon = 0;
  if (kind === null) {
    return out;
  }
  // Minutes from the middle, either way round midnight.
  const fromMiddle = wrapMinutes(minutes - centreMinutes + MINUTES_PER_DAY / 2) - MINUTES_PER_DAY / 2;
  const away = Math.abs(fromMiddle);
  const side = fromMiddle < 0 ? -1 : 1;
  if (kind === 'solar') {
    const total = config.solarTotalMinutes / 2;
    const partial = config.solarPartialMinutes;
    if (away >= total + partial) {
      return out;
    }
    // From the moon's first touch (its edge on the sun's) to the second (its edge past the sun's far one), and across.
    const touching = 1 + MOON_OVER_SUN;
    const hiding = MOON_OVER_SUN - 1;
    const offset = away <= total ? (away / total) * hiding : hiding + ((away - total) / partial) * (touching - hiding);
    out.kind = kind;
    out.offset = side * offset;
    out.cover = discOverlap(offset, 1, MOON_OVER_SUN) / Math.PI;
  } else {
    const total = config.lunarTotalMinutes / 2;
    const partial = config.lunarPartialMinutes;
    const penumbral = config.lunarPenumbralMinutes;
    if (away >= total + partial + penumbral) {
      return out;
    }
    // Along its path, missing the shadow's middle a little: wholly in the full shadow, touching it, touching the half shadow.
    const inside = alongPath(UMBRA_RADIUS - 1);
    const umbral = alongPath(UMBRA_RADIUS + 1);
    const penumbralTouch = alongPath(PENUMBRA_RADIUS + 1);
    const along =
      away <= total
        ? (away / total) * inside
        : away <= total + partial
          ? inside + ((away - total) / partial) * (umbral - inside)
          : umbral + ((away - total - partial) / penumbral) * (penumbralTouch - umbral);
    const distance = Math.sqrt(along * along + LUNAR_PATH_MISS * LUNAR_PATH_MISS);
    out.kind = kind;
    out.offset = side * along;
    out.cover = discOverlap(distance, 1, UMBRA_RADIUS) / Math.PI;
    out.penumbra = discOverlap(distance, 1, PENUMBRA_RADIUS) / Math.PI;
    out.fullMoon = smoothstep(0, penumbral * FULL_MOON_PULL_SHARE, total + partial + penumbral - away);
  }
  out.cover = clamp(out.cover, 0, 1);
  out.penumbra = clamp(out.penumbra, 0, 1);
  out.totality = smoothstep(TOTALITY_FROM, 1, out.cover);
  return out;
}

/**
 * The area two discs of radii `r1` and `r2` share with their middles
 * `distance` apart: 0 apart, the smaller's whole area one inside the other.
 */
export function discOverlap(distance: number, r1: number, r2: number): number {
  const d = Math.abs(distance);
  if (d >= r1 + r2) {
    return 0;
  }
  if (d <= Math.abs(r1 - r2)) {
    const r = Math.min(r1, r2);
    return Math.PI * r * r;
  }
  const a = r1 * r1 * Math.acos(clamp((d * d + r1 * r1 - r2 * r2) / (2 * d * r1), -1, 1));
  const b = r2 * r2 * Math.acos(clamp((d * d + r2 * r2 - r1 * r1) / (2 * d * r2), -1, 1));
  const c = 0.5 * Math.sqrt(Math.max(0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
  return a + b - c;
}

/** The share of the sun's light left with `cover` of its disc hidden, as the eye takes it: a deep twilight at totality. */
export function eclipseDaylight(cover: Fraction): Fraction {
  return 1 - (1 - DAYLIGHT_LEFT) * smoothstep(DARKENS_FROM, 1, cover);
}

/** The share of the moon's light left in an eclipse of it (`eclipse`, as eclipseAt wrote it); 1 without one. */
export function eclipseMoonlight(eclipse: Readonly<EclipseState>): Fraction {
  if (eclipse.kind !== 'lunar') {
    return 1;
  }
  const halfShadow = Math.max(0, eclipse.penumbra - eclipse.cover);
  return clamp((1 - (1 - MOONLIGHT_IN_UMBRA) * eclipse.cover) * (1 - PENUMBRA_DIMMING * halfShadow), MOONLIGHT_IN_UMBRA, 1);
}

/**
 * The sky in an eclipse of the sun (`eclipse`, as eclipseAt wrote it),
 * changed in place: darker as more of the sun is hidden, to a deep
 * twilight at totality, the stars out where it is clear and the lamps lit.
 * Untouched without one. Allocation-free.
 */
export function eclipseSky(look: SkyLook, eclipse: Readonly<EclipseState>): SkyLook {
  if (eclipse.kind !== 'solar' || eclipse.cover <= 0) {
    return look;
  }
  const dark = smoothstep(DARKENS_FROM, 1, eclipse.cover);
  const totality = eclipse.totality;
  look.sunlight *= eclipseDaylight(eclipse.cover);
  look.skylight *= 1 - (1 - SKYLIGHT_LEFT) * dark;
  look.cloudBrightness *= 1 - 0.75 * dark;
  look.zenithColor = mixColor(look.zenithColor, ECLIPSE_ZENITH, 0.9 * dark);
  look.horizonColor = mixColor(look.horizonColor, ECLIPSE_HORIZON, 0.7 * dark);
  look.lightColor = mixColor(look.lightColor, ECLIPSE_LIGHT, 0.5 * dark);
  const clear = (1 - smoothstep(0.55, 0.9, look.cloudCover)) * (1 - look.rain);
  look.stars = Math.max(look.stars, ECLIPSE_STARS * totality * clear);
  look.lamps = Math.max(look.lamps, ECLIPSE_LAMPS * totality);
  look.saturation = clamp(look.saturation * (1 - 0.2 * dark), 0.5, 1.5);
  look.warmth = clamp(look.warmth - 0.15 * dark, -1, 1);
  look.bloom = Math.max(look.bloom, ECLIPSE_BLOOM * totality);
  return look;
}

/**
 * The lunation's draw: whether its new (or full) moon (at `atMs`) brings an
 * eclipse, and its middle: when the sun (the full moon, opposite it) stands
 * the drawn height on the drawn side of its highest.
 */
function drawEclipse(kind: EclipseKind, lunation: number, atMs: number, config: EclipseConfig, sky: EclipseSky): EclipseOfDay | null {
  const random = new SeededRandom(Math.imul(lunation + (kind === 'solar' ? 0x1f3d : 0x6c8b), 0x2c1b3c6d) ^ 0x5bd1e995);
  if (random.next() >= (kind === 'solar' ? config.solarChance : config.lunarChance)) {
    return null;
  }
  const [low, high] = kind === 'solar' ? SOLAR_HEIGHT_DEGREES : LUNAR_HEIGHT_DEGREES;
  const height = degreesToRadians(random.range(low, high));
  const side = random.sign();
  const day = dayOfYear(atMs);
  const declination = kind === 'solar' ? sunDeclination(day) : moonDeclination(day, 0.5);
  const fromHighest = (hourAngleAt(height, declination, degreesToRadians(sky.latitudeDegrees)) / (2 * Math.PI)) * MINUTES_PER_DAY;
  // The full moon stands highest at the sun's lowest, twelve hours on.
  const highest = sky.solarNoonHours * 60 + (kind === 'lunar' ? MINUTES_PER_DAY / 2 : 0);
  return eclipseOfDay(kind, highest + side * fromHighest, config);
}

function eclipseOfDay(kind: EclipseKind, middle: number, config: EclipseConfig): EclipseOfDay {
  const centreMinutes = wrapMinutes(Math.round(middle / ROUND_MINUTES) * ROUND_MINUTES);
  const total = kind === 'solar' ? config.solarTotalMinutes : config.lunarTotalMinutes;
  return { kind, centreMinutes, totalityMinutes: wrapMinutes(Math.round(centreMinutes - total / 2)) };
}

/** How far along the moon's path its middle is from the shadow's nearest point when `distance` from the shadow's middle. */
function alongPath(distance: number): number {
  return Math.sqrt(Math.max(0, distance * distance - LUNAR_PATH_MISS * LUNAR_PATH_MISS));
}
