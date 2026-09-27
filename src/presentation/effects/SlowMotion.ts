/** Game time runs this share of real time in the moment of slow motion… */
const SLOW_SHARE = 0.3;
/** …for this long (real seconds), then eases back to real time over this long. */
const HOLD_SECONDS = 0.45;
const EASE_SECONDS = 0.5;

/**
 * A moment of slow motion after a big crash (a car wrecked at speed): game
 * time drops to under a third of real time at once, holds a moment, then
 * eases back. update() gives the time scale to run at (GameLoop.timeScale).
 * Allocation-free.
 */
export class SlowMotion {
  private holdSeconds = 0;
  private easeSeconds = 0;

  /** Starts the moment (again, if one is under way). */
  trigger(): void {
    this.holdSeconds = HOLD_SECONDS;
    this.easeSeconds = EASE_SECONDS;
  }

  /** Whether game time runs slower than real time now. */
  get active(): boolean {
    return this.holdSeconds > 0 || this.easeSeconds > 0;
  }

  /** The time scale after `realSeconds` more of real time: 1 outside the moment. */
  update(realSeconds: number): number {
    const seconds = Number.isFinite(realSeconds) ? Math.max(0, realSeconds) : 0;
    if (this.holdSeconds > 0) {
      this.holdSeconds -= seconds;
      return SLOW_SHARE;
    }
    if (this.easeSeconds > 0) {
      this.easeSeconds = Math.max(0, this.easeSeconds - seconds);
      const t = 1 - this.easeSeconds / EASE_SECONDS;
      return SLOW_SHARE + (1 - SLOW_SHARE) * t * t * (3 - 2 * t);
    }
    return 1;
  }
}
