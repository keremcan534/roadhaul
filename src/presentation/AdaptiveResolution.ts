/**
 * Frames slower on average than SLOW_SHARE of the target frame rate lower
 * the resolution (the target: the screen's rate, or the player's cap under
 * it; never slower than 27 FPS, the old floor); frames at QUICK_SHARE of it
 * or better, for a good while, raise it again. A 60 Hz screen: under 48 FPS
 * down, over 57 up; 120 Hz: under 96, over 114.
 */
const SLOW_SHARE = 0.8;
const QUICK_SHARE = 0.95;
const FLOOR_FRAME_SECONDS = 1 / 27;
/** Before any frame is measured, the target is taken as this. */
const DEFAULT_TARGET_FPS = 60;
/** The screens' usual refresh rates: the one nearest the shortest frame seen is the screen's. */
const REFRESH_RATES = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165] as const;
/** Frames quicker than this are not a screen's: two callbacks in one frame. */
const SHORTEST_FRAME_SECONDS = 1 / 250;
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
 * Dynamic resolution (ARCHITECTURE.md §11): when frames fall well short of
 * the target frame rate (the screen's, 60, 90 or 120, under the player's
 * cap) on average, draw fewer pixels; when they are quick again for
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
  /** The shortest frame seen yet, seconds: the screen's refresh interval (or the cap's), at the light menus. */
  private shortestFrame = Number.POSITIVE_INFINITY;
  /** The player's cap, frames a second; 0: none. */
  private cap = 0;

  constructor(private readonly minScale: number) {}

  /** The player's frame rate cap (0: as many as the screen shows): the target is never above it. */
  setFrameCap(framesPerSecond: number): void {
    this.cap = framesPerSecond > 0 ? framesPerSecond : 0;
  }

  /** The frame rate aimed at: the screen's (as seen), under the player's cap. */
  get targetFps(): number {
    const seen = Number.isFinite(this.shortestFrame) ? nearestRefreshRate(1 / this.shortestFrame) : DEFAULT_TARGET_FPS;
    return this.cap > 0 ? Math.min(this.cap, seen) : seen;
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
      return false;
    }
    if (deltaSeconds > SHORTEST_FRAME_SECONDS && deltaSeconds < this.shortestFrame) {
      this.shortestFrame = deltaSeconds;
    }
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
    const target = this.targetFps;
    if (average > Math.min(FLOOR_FRAME_SECONDS, 1 / (SLOW_SHARE * target))) {
      this.quickWindows = 0;
      return work < CPU_BOUND_SHARE && this.setScale(this.current * LOWER_FACTOR);
    }
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

  /** Measures afresh (after the page was hidden), keeping the scale. */
  restart(): void {
    this.windowSeconds = 0;
    this.windowWorkSeconds = 0;
    this.windowFrames = 0;
    this.quickWindows = 0;
    this.warmingUp = true;
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
