/** Tolerance for floating-point drift, e.g. 3 × (1/60) summing to slightly less than 3/60. */
const EPSILON_SECONDS = 1e-9;

/**
 * Converts variable frame times into a whole number of fixed simulation steps
 * (the classic accumulator pattern). Physics and game rules run at a fixed
 * rate regardless of frame rate, which keeps them deterministic and stable.
 */
export class FixedTimestep {
  private accumulatorSeconds = 0;

  constructor(
    /** Duration of one simulation step, e.g. 1/60 s. */
    readonly stepSeconds: number,
    /**
     * Upper bound on steps per frame. On a slow device the simulation falls
     * behind real time instead of spiralling into ever longer frames.
     */
    readonly maxStepsPerFrame: number,
  ) {
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
      throw new RangeError(`stepSeconds must be a positive number, got ${stepSeconds}.`);
    }
    if (!Number.isInteger(maxStepsPerFrame) || maxStepsPerFrame < 1) {
      throw new RangeError(`maxStepsPerFrame must be a positive integer, got ${maxStepsPerFrame}.`);
    }
  }

  /**
   * How far the simulation is between the last step and the next one (0..1).
   * Rendering uses it to interpolate between the last two simulated states.
   */
  get alpha(): number {
    return this.accumulatorSeconds / this.stepSeconds;
  }

  /** Adds a frame's elapsed time and returns how many fixed steps to run now. */
  advance(frameDeltaSeconds: number): number {
    if (frameDeltaSeconds > 0) {
      this.accumulatorSeconds += frameDeltaSeconds;
    }
    let steps = 0;
    while (steps < this.maxStepsPerFrame && this.accumulatorSeconds + EPSILON_SECONDS >= this.stepSeconds) {
      this.accumulatorSeconds -= this.stepSeconds;
      steps++;
    }
    if (this.accumulatorSeconds < 0) {
      this.accumulatorSeconds = 0;
    } else if (this.accumulatorSeconds >= this.stepSeconds) {
      // Hit maxStepsPerFrame: drop the backlog, keep the fraction of a step.
      this.accumulatorSeconds %= this.stepSeconds;
    }
    return steps;
  }

  reset(): void {
    this.accumulatorSeconds = 0;
  }
}
