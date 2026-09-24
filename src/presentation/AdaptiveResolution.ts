/** Frames slower than this on average lower the resolution: under 27 FPS. */
const SLOW_FRAME_SECONDS = 1 / 27;
/** Frames quicker than this on average, for a good while, raise it again: over 50 FPS. */
const QUICK_FRAME_SECONDS = 1 / 50;
/** Frame times are averaged over windows this long. */
const WINDOW_SECONDS = 2;
/** Quick windows in a row before the resolution goes back up (slow ones act at once). */
const QUICK_WINDOWS_TO_RAISE = 3;
const LOWER_FACTOR = 0.85;
const RAISE_FACTOR = 1.1;
/** Longer frames are hitches (a tab switch, a page loading), not a measure of the device. */
const HITCH_SECONDS = 0.2;

/**
 * Dynamic resolution (ARCHITECTURE.md §11, a 30 FPS floor): when frames
 * take too long on average, draw fewer pixels; when they are quick again for
 * a good while, draw more, up to the full pixel ratio. The wide gap between
 * the two thresholds keeps it from see-sawing. Frame times in, a scale
 * (minScale..1) of the pixel ratio out; the render host applies it.
 */
export class AdaptiveResolution {
  private current = 1;
  private windowSeconds = 0;
  private windowFrames = 0;
  private quickWindows = 0;
  /** The first window after a (re)start is not measured: shaders compile, textures upload. */
  private warmingUp = true;

  constructor(private readonly minScale: number) {}

  /** The share of the full pixel ratio to draw at. */
  get scale(): number {
    return this.current;
  }

  /** Counts one frame that took `deltaSeconds`. True when the scale changed. Allocation-free. */
  frame(deltaSeconds: number): boolean {
    if (!(deltaSeconds > 0) || deltaSeconds > HITCH_SECONDS) {
      return false;
    }
    this.windowSeconds += deltaSeconds;
    this.windowFrames++;
    if (this.windowSeconds < WINDOW_SECONDS) {
      return false;
    }
    const average = this.windowSeconds / this.windowFrames;
    this.windowSeconds = 0;
    this.windowFrames = 0;
    if (this.warmingUp) {
      this.warmingUp = false;
      return false;
    }
    if (average > SLOW_FRAME_SECONDS) {
      this.quickWindows = 0;
      return this.setScale(this.current * LOWER_FACTOR);
    }
    if (average < QUICK_FRAME_SECONDS && this.current < 1) {
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
