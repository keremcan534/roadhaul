/**
 * Frames slower on average than SLOW_SHARE of the rate aimed at lower the
 * resolution; frames at QUICK_SHARE of it or better, for a good while, raise
 * it again. The rate aimed at is the screen's (or the player's cap under it),
 * but never above SHARP_FPS for the pixels' sake: past 60 frames a second a
 * sharp picture is worth more than more frames, so a 90 or 120 Hz screen
 * shows as many as the phone draws at its full resolution, and only frames
 * under 48 a second (SLOW_SHARE of 60) cost pixels. Never slower than 27 FPS,
 * the old floor.
 */
const SLOW_SHARE = 0.8;
const QUICK_SHARE = 0.95;
const FLOOR_FRAME_SECONDS = 1 / 27;
/** The most frames a second the resolution is lowered for. */
const SHARP_FPS = 60;
/** Before any frame is measured, the target is taken as this. */
const DEFAULT_TARGET_FPS = 60;
/** The screens' usual refresh rates: the one nearest the shortest frame seen is the screen's. */
const REFRESH_RATES = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165] as const;
/** Frames quicker than this are not a screen's: two callbacks in one frame. */
const SHORTEST_FRAME_SECONDS = 1 / 250;
/**
 * A frame time counts toward the screen's rate only when this many frames
 * in a row were that quick: one frame can come early (its timestamp
 * jittering round the screen's beat, the next late), several in a row on
 * a screen too slow for them cannot.
 */
const FRAMES_IN_A_ROW = 3;
/** Frame times are averaged over windows this long. */
const WINDOW_SECONDS = 2;
/** Quick windows in a row before the resolution goes back up (slow ones act at once). */
const QUICK_WINDOWS_TO_RAISE = 3;
const LOWER_FACTOR = 0.85;
const RAISE_FACTOR = 1.1;
/** Longer frames are hitches (a tab switch, a page loading), not a measure of the device. */
const HITCH_SECONDS = 0.2;
/**
 * Slow frames whose own work on the main thread takes this share of them or
 * more are the CPU's: fewer pixels would not make them quicker (only a GPU
 * short of time to fill them is helped), and each step down is a hitch.
 */
const CPU_BOUND_SHARE = 0.8;
/**
 * Slow windows in a row at the lowest scale before the target is taken as
 * out of the device's reach: from then on it aims at half the rate (a 60 Hz
 * screen's 30), and the pixels come back as frames keep up with that.
 * Without it a phone whose GPU cannot draw 48 frames a second at any
 * resolution would stay blurred at the lowest for nothing.
 */
const OUT_OF_REACH_WINDOWS = 2;
/** The lowest target an out-of-reach one steps down to, frames a second. */
const LOWEST_TARGET_FPS = 30;

/**
 * Dynamic resolution (ARCHITECTURE.md §11): when frames fall well short of
 * the target frame rate (the screen's under the player's cap, at most 60)
 * on average, draw fewer pixels; when they are quick again for
 * a good while, draw more, up to the full pixel ratio. The wide gap between
 * the two thresholds keeps it from see-sawing. Frames slow because the main
 * thread's own work fills them (a low-end phone's CPU) keep their pixels:
 * the picture would only blur. Frame times in, a scale (minScale..1) of the
 * pixel ratio out; the render host applies it.
 */
export class AdaptiveResolution {
  private current = 1;
  private windowSeconds = 0;
  private windowFrames = 0;
  private windowWorkSeconds = 0;
  private quickWindows = 0;
  /** The first window after a (re)start is not measured: shaders compile, textures upload. */
  private warmingUp = true;
  /** The shortest frame seen yet FRAMES_IN_A_ROW times in a row, seconds: the screen's refresh interval (or the cap's). */
  private shortestFrame = Number.POSITIVE_INFINITY;
  /** The frames just before this one (FRAMES_IN_A_ROW - 1 of them, the latest first), and how many in a row were seen. */
  private readonly recentFrames = [0, 0];
  private recentCount = 0;
  /** The player's cap, frames a second; 0: none. */
  private cap = 0;
  /** The most the device was seen able to aim for (OUT_OF_REACH_WINDOWS), frames a second; infinite until then. */
  private reach = Number.POSITIVE_INFINITY;
  /** Slow windows in a row at the lowest scale. */
  private slowAtLowest = 0;

  constructor(private readonly minScale: number) {}

  /** The player's frame rate cap (0: as many as the screen shows): the target is never above it. */
  setFrameCap(framesPerSecond: number): void {
    this.cap = framesPerSecond > 0 ? framesPerSecond : 0;
  }

  /** The frame rate aimed at: the screen's (as seen), under the player's cap and the device's reach. */
  get targetFps(): number {
    const seen = Number.isFinite(this.shortestFrame) ? nearestRefreshRate(1 / this.shortestFrame) : DEFAULT_TARGET_FPS;
    return Math.min(this.cap > 0 ? Math.min(this.cap, seen) : seen, this.reach);
  }

  /** The share of the full pixel ratio to draw at. */
  get scale(): number {
    return this.current;
  }

  /**
   * Counts one frame that took `deltaSeconds`, `workSeconds` of it the main
   * thread's own work (0 if unknown). True when the scale changed.
   * Allocation-free.
   */
  frame(deltaSeconds: number, workSeconds = 0): boolean {
    if (!(deltaSeconds > 0) || deltaSeconds > HITCH_SECONDS) {
      this.recentCount = 0;
      return false;
    }
    this.seeScreenBeat(deltaSeconds);
    this.windowSeconds += deltaSeconds;
    this.windowWorkSeconds += Math.min(Math.max(workSeconds, 0), deltaSeconds);
    this.windowFrames++;
    if (this.windowSeconds < WINDOW_SECONDS) {
      return false;
    }
    const average = this.windowSeconds / this.windowFrames;
    const work = this.windowWorkSeconds / this.windowSeconds;
    this.windowSeconds = 0;
    this.windowWorkSeconds = 0;
    this.windowFrames = 0;
    if (this.warmingUp) {
      this.warmingUp = false;
      return false;
    }
    // The rate the pixels are traded for: the target, but not above SHARP_FPS.
    const target = Math.min(this.targetFps, SHARP_FPS);
    if (average > Math.min(FLOOR_FRAME_SECONDS, 1 / (SLOW_SHARE * target))) {
      this.quickWindows = 0;
      if (work >= CPU_BOUND_SHARE) {
        this.slowAtLowest = 0;
        return false;
      }
      if (this.setScale(this.current * LOWER_FACTOR)) {
        return true;
      }
      // As few pixels as it may draw, and still slow.
      if (++this.slowAtLowest >= OUT_OF_REACH_WINDOWS && target > LOWEST_TARGET_FPS) {
        this.slowAtLowest = 0;
        this.reach = Math.max(LOWEST_TARGET_FPS, target / 2);
      }
      return false;
    }
    this.slowAtLowest = 0;
    if (average < 1 / (QUICK_SHARE * target) && this.current < 1) {
      this.quickWindows++;
      if (this.quickWindows < QUICK_WINDOWS_TO_RAISE) {
        return false;
      }
      this.quickWindows = 0;
      return this.setScale(this.current * RAISE_FACTOR);
    }
    this.quickWindows = 0;
    return false;
  }

  /**
   * Measures afresh (after the page was hidden), keeping the scale and the
   * device's reach: the screen's rate too, which may have changed meanwhile
   * (a battery saver holding it at 60).
   */
  restart(): void {
    this.windowSeconds = 0;
    this.windowWorkSeconds = 0;
    this.windowFrames = 0;
    this.quickWindows = 0;
    this.slowAtLowest = 0;
    this.recentCount = 0;
    this.shortestFrame = Number.POSITIVE_INFINITY;
    this.warmingUp = true;
  }

  /** The screen's beat: the shortest frame time held FRAMES_IN_A_ROW frames in a row. */
  private seeScreenBeat(deltaSeconds: number): void {
    const recent = this.recentFrames;
    // The slowest of this frame and the ones before it: what all of them were at least as quick as.
    let held = deltaSeconds;
    for (let i = 0; i < recent.length; i++) {
      held = Math.max(held, recent[i]!);
    }
    for (let i = recent.length - 1; i > 0; i--) {
      recent[i] = recent[i - 1]!;
    }
    recent[0] = deltaSeconds;
    this.recentCount = Math.min(this.recentCount + 1, FRAMES_IN_A_ROW);
    if (this.recentCount >= FRAMES_IN_A_ROW && held > SHORTEST_FRAME_SECONDS && held < this.shortestFrame) {
      this.shortestFrame = held;
    }
  }

  private setScale(scale: number): boolean {
    const next = Math.min(1, Math.max(this.minScale, scale));
    if (Math.abs(next - this.current) < 1e-6) {
      return false;
    }
    this.current = next;
    return true;
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
