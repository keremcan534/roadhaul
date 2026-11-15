/** The screens' usual refresh rates: the one nearest the shortest beat seen is the screen's. */
const REFRESH_RATES = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165] as const;
/** Callbacks closer than this are not a screen's beat: two in one frame. */
const SHORTEST_BEAT_SECONDS = 1 / 250;
/** A beat counts toward the screen's rate only when this many in a row were that quick (one can come early). */
const BEATS_IN_A_ROW = 3;
/**
 * Before the screen's beat is seen, it is taken as this, and never as less:
 * a phone whose every frame takes longer than a beat gets its callbacks at
 * its own pace, not the screen's (a 60 Hz screen drawing 30 a second would
 * look like a 30 Hz one). A faster screen shows its beat in the callbacks
 * skipped once frames are paced.
 */
const DEFAULT_SCREEN_FPS = 60;
/** No rate is paced below this: a phone that cannot keep it shows what it can. */
const LOWEST_FPS = 30;
/** Frames are counted over windows this long. */
const WINDOW_SECONDS = 2;
/** Longer frames are hitches (a tab switch, a page loading), not a measure of the phone. */
const HITCH_SECONDS = 0.25;
/**
 * The rate aimed at is kept while frames come at this share of it or
 * more: a little short, most frames still show for one beat.
 */
const KEEP_SHARE = 0.85;
/**
 * …or at this many a second: about 60 and more, frames shown for one beat
 * or two of a 90, 120 or 144 Hz screen differ by 11 ms or less, and more of
 * them is the smoother drive.
 */
const KEEP_FPS = 58;
/** Windows in a row short of the rate before it is given up for a lower one. */
const SLOW_WINDOWS = 2;
/** A lower rate is paced at only where the frames came at this share of it or more. */
const FITS_SHARE = 0.97;
/** How long the frames keep up with a paced rate before the rate above is tried again, seconds; doubled after each failed try. */
const FIRST_TRY_SECONDS = 30;
const LONGEST_TRY_SECONDS = 480;

/**
 * Even frame pacing (ARCHITECTURE.md §11). A phone that cannot keep up with
 * its screen shows frames unevenly, one for one refresh and the next for
 * two, and the drive judders: 45 frames a second on a 60 Hz screen look
 * rougher than 30 shown evenly, and run the phone hotter. On the road,
 * after SLOW_WINDOWS windows short of the rate aimed at (under KEEP_SHARE
 * of it and under KEEP_FPS), the frames are
 * capped at the screen's rate divided by a whole number (60 Hz: 30; 90 Hz:
 * 45 or 30; 120 Hz: 60, 40 or 30), the highest the phone kept: each frame
 * then shows as long as the next. After FIRST_TRY_SECONDS of frames keeping
 * up, the rate above is tried again for a window, and kept if the frames
 * keep up with it; each failed try doubles the wait. The player's cap
 * (Settings: 30, 60) is the most it aims for. Frame times in, a cap out;
 * the game loop applies it (GameLoop.maxFramesPerSecond). Allocation-free.
 */
export class FramePacing {
  /** The player's cap, frames a second; 0: none. */
  private ceiling = 0;
  /** The screen's beat: the shortest callback interval held BEATS_IN_A_ROW times in a row, seconds. */
  private shortestBeat = Number.POSITIVE_INFINITY;
  /** The beat seen before the last restart: taken until the screen's is seen again. */
  private previousBeat = Number.POSITIVE_INFINITY;
  private readonly recentBeats = [0, 0];
  private recentBeatCount = 0;
  /** The rates paced at, from the one aimed at down (the screen's divided by 1, 2, 3…, under the ceiling). */
  private readonly rates = new Float64Array(8);
  private rateCount = 0;
  /** The screen's rate and the ceiling the rates were made for. */
  private ratesScreenFps = 0;
  private ratesCeiling = -1;
  /** The rate paced at now (an index into `rates`); 0 is the one aimed at, uncapped but for the player's cap. */
  private level = 0;
  /** While trying the rate above (`level` - 1) for a window. */
  private trying = false;
  private windowSeconds = 0;
  private windowFrames = 0;
  private warmingUp = true;
  private slowWindows = 0;
  /** How long the frames have kept up with the paced rate, and how long to wait before trying the one above. */
  private keptSeconds = 0;
  private waitSeconds = FIRST_TRY_SECONDS;
  /** Whether the rate paced at was reached by a try that kept up: falling back from it counts as a failed try. */
  private triedUp = false;

  constructor() {
    this.rebuild(DEFAULT_SCREEN_FPS);
  }

  /** The player's cap (0: as many as the screen shows): the most frames a second it paces at. */
  setCeiling(framesPerSecond: number): void {
    this.ceiling = framesPerSecond > 0 ? framesPerSecond : 0;
    this.level = 0;
    this.trying = false;
    this.triedUp = false;
    this.waitSeconds = FIRST_TRY_SECONDS;
    this.rebuild(this.screenFps);
    this.restart();
  }

  /** The screen's refresh rate as seen (60 until seen, and at least 60). */
  get screenFps(): number {
    const beat = Number.isFinite(this.shortestBeat) ? this.shortestBeat : this.previousBeat;
    return Number.isFinite(beat) ? Math.max(DEFAULT_SCREEN_FPS, nearestRefreshRate(1 / beat)) : DEFAULT_SCREEN_FPS;
  }

  /** The frames a second the game loop is capped at now: 0 for no cap (the player's own, if any, aside). */
  get cap(): number {
    const level = this.trying ? this.level - 1 : this.level;
    return level === 0 ? this.ceiling : this.rates[level]!;
  }

  /** The rate paced at, leaving out a try of the one above: what frames are expected at (AdaptiveResolution). */
  get steadyCap(): number {
    return this.level === 0 ? this.ceiling : this.rates[this.level]!;
  }

  /** Whether the frames are paced under the rate aimed at. */
  get paced(): boolean {
    return this.level > 0;
  }

  /**
   * Counts one frame drawn on the road: `frameSeconds` since the frame drawn
   * before, `beatSeconds` since the scheduler's callback before (drawn or
   * skipped under the cap: the screen's beat). True when the cap changed.
   */
  frame(frameSeconds: number, beatSeconds: number): boolean {
    this.seeBeat(beatSeconds);
    if (!(frameSeconds > 0) || frameSeconds > HITCH_SECONDS) {
      return false;
    }
    this.windowSeconds += frameSeconds;
    this.windowFrames++;
    if (this.windowSeconds < WINDOW_SECONDS) {
      return false;
    }
    const fps = this.windowFrames / this.windowSeconds;
    const seconds = this.windowSeconds;
    this.windowSeconds = 0;
    this.windowFrames = 0;
    if (this.warmingUp) {
      this.warmingUp = false;
      return false;
    }
    if (this.rebuild(this.screenFps)) {
      return true;
    }
    if (this.trying) {
      this.trying = false;
      this.triedUp = this.keeps(fps, this.level - 1);
      if (this.triedUp) {
        this.level--;
      } else {
        this.waitLonger();
      }
      this.keptSeconds = 0;
      this.slowWindows = 0;
      return true;
    }
    if (!this.keeps(fps, this.level)) {
      this.keptSeconds = 0;
      if (++this.slowWindows < SLOW_WINDOWS || this.level === this.rateCount - 1) {
        return false;
      }
      this.slowWindows = 0;
      // A rate a try reached and the frames could not keep: tries come less often from now on.
      if (this.triedUp) {
        this.triedUp = false;
        this.waitLonger();
      }
      // The highest rate below that the frames came at; the lowest if none.
      let next = this.level + 1;
      while (next < this.rateCount - 1 && fps < FITS_SHARE * this.rates[next]!) {
        next++;
      }
      this.level = next;
      return true;
    }
    this.slowWindows = 0;
    if (this.level === 0) {
      return false;
    }
    this.keptSeconds += seconds;
    if (this.keptSeconds < this.waitSeconds) {
      return false;
    }
    this.keptSeconds = 0;
    this.trying = true;
    return true;
  }

  /**
   * Measures afresh (after the page was hidden): the screen's beat too,
   * which may have changed meanwhile (a battery saver holding it at 60).
   * The rate paced at is kept while the screen's stays the same; its next
   * try waits again.
   */
  restart(): void {
    this.windowSeconds = 0;
    this.windowFrames = 0;
    this.warmingUp = true;
    this.slowWindows = 0;
    this.keptSeconds = 0;
    this.recentBeatCount = 0;
    if (Number.isFinite(this.shortestBeat)) {
      this.previousBeat = this.shortestBeat;
    }
    this.shortestBeat = Number.POSITIVE_INFINITY;
    this.trying = false;
  }

  private waitLonger(): void {
    this.waitSeconds = Math.min(LONGEST_TRY_SECONDS, this.waitSeconds * 2);
  }

  /** Whether frames at `fps` keep up with the rate at `level`. */
  private keeps(fps: number, level: number): boolean {
    const rate = this.rates[level]!;
    return fps >= KEEP_SHARE * rate || (level === 0 && fps >= KEEP_FPS);
  }

  /** The screen's beat: the slowest of this callback and the ones before it, when quicker than any seen. */
  private seeBeat(seconds: number): void {
    if (!(seconds > SHORTEST_BEAT_SECONDS)) {
      return;
    }
    const recent = this.recentBeats;
    let held = seconds;
    for (let i = 0; i < recent.length; i++) {
      held = Math.max(held, recent[i]!);
    }
    for (let i = recent.length - 1; i > 0; i--) {
      recent[i] = recent[i - 1]!;
    }
    recent[0] = seconds;
    this.recentBeatCount = Math.min(this.recentBeatCount + 1, BEATS_IN_A_ROW);
    if (this.recentBeatCount >= BEATS_IN_A_ROW && held < this.shortestBeat) {
      this.shortestBeat = held;
    }
  }

  /**
   * The rates for a screen of `screenFps`: the rate aimed at (the screen's,
   * under the ceiling), then the screen's divided by 2, 3… down to
   * LOWEST_FPS, under it. When they change, the frames stay paced at the
   * highest of them no higher than before. True when the cap changed.
   */
  private rebuild(screenFps: number): boolean {
    if (screenFps === this.ratesScreenFps && this.ceiling === this.ratesCeiling) {
      return false;
    }
    this.ratesScreenFps = screenFps;
    this.ratesCeiling = this.ceiling;
    const top = this.ceiling > 0 ? Math.min(this.ceiling, screenFps) : screenFps;
    const before = this.cap;
    const paced = this.level > 0 ? this.rates[this.level]! : 0;
    this.rates[0] = top;
    let count = 1;
    for (let divisor = 2; count < this.rates.length; divisor++) {
      const rate = screenFps / divisor;
      if (rate < LOWEST_FPS - 0.5) {
        break;
      }
      if (rate < top - 0.5) {
        this.rates[count++] = rate;
      }
    }
    this.rateCount = count;
    this.level = 0;
    if (paced > 0) {
      while (this.level < count - 1 && this.rates[this.level]! > paced + 0.5) {
        this.level++;
      }
    }
    this.trying = false;
    this.triedUp = false;
    this.slowWindows = 0;
    this.keptSeconds = 0;
    return this.cap !== before;
  }

}

/** The usual refresh rate nearest `fps`. */
function nearestRefreshRate(fps: number): number {
  let best: number = REFRESH_RATES[0];
  for (const rate of REFRESH_RATES) {
    if (Math.abs(rate - fps) < Math.abs(best - fps)) {
      best = rate;
    }
  }
  return best;
}
