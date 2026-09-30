// The store video's cut, on a 120 BPM beat: the scenes' starts, and the moments the soundtrack marks. The picture
// (promo.js, in the page that draws it) and the sound (soundtrack.mjs) both follow it.

export const BPM = 120;
/** Seconds a beat; a bar is four. */
export const BEAT = 60 / BPM;
export const DURATION = 32;

/** Where each scene starts, in seconds: every cut falls on a beat, and each scene on a bar. */
export const SCENES = {
  /** A road's centre line opens on the truck in the country: "Start with one truck." */
  open: 0,
  /** The job board on a phone: "Take the job." */
  job: 4,
  /** From the driver's seat: "Hit the road." */
  road: 6,
  /** Dawn mist, a rainbow, night rain and snow, two beats each: "A living world." */
  world: 8,
  /** A delivery's pay: "Deliver. Get paid." */
  paid: 12,
  /** The truck's page and the garage: "Upgrade your truck." */
  garage: 14,
  /** The fleet, the company, the rivals: "Build your company." */
  company: 18,
  /** Slow motion into the sunset: "Drive. Deliver. Grow." */
  finale: 22,
  /** The brand, and where to get it. */
  end: 26,
};

/** The world montage's cuts: one clip each. */
export const WORLD_CUTS = [8, 9, 10, 11];
/** The finale's three words land on these beats. */
export const FINALE_WORDS = [22, 23, 24];
/**
 * A finger taps the phone: the job board's "Take the job"; in the garage three paints on the beats, "Paint it", and
 * the engine's upgrade.
 */
export const TAPS = { job: 5.2, paints: [14.25, 14.75, 15.25], paint: 15.75, upgrade: 17 };
/** The pay counts up from the first moment, and rings when it lands at the second. */
export const PAY_COUNT = [12.5, 13.3];
/** The cuts with a sweep of air under them. */
export const WHOOSHES = [4, 6, 8, 12, 14, 18];
