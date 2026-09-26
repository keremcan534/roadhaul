import type { FixedTimestep } from './FixedTimestep';

/** Frame timing source. In the browser: requestAnimationFrame. In tests: a fake. */
export interface FrameScheduler {
  /** Calls `callback` with a monotonic timestamp in milliseconds on the next frame. */
  request(callback: (timestampMs: number) => void): number;
  cancel(handle: number): void;
}

export interface GameLoopHandlers {
  /** Runs zero or more times per frame with the fixed step: physics and game rules go here. */
  fixedUpdate(stepSeconds: number): void;
  /**
   * Runs once per frame after the fixed steps: animation and rendering go here.
   * `alpha` (0..1) is the progress towards the next fixed step, for interpolation.
   */
  frameUpdate(frameDeltaSeconds: number, alpha: number): void;
  /** Called when a handler throws. The loop has already stopped. */
  onError(error: unknown): void;
}

export interface GameLoopOptions {
  /**
   * Longer frames (tab switches, debugger pauses, slow devices) are clamped to
   * this so the game does not try to simulate the whole gap at once.
   */
  readonly maxFrameDeltaSeconds: number;
  /**
   * How much of a longer frame the simulation catches up, when it may catch up
   * more than the animation does (maxFrameDeltaSeconds, the default): where
   * drawing is slow but simulating quick (drawn in software), the game keeps
   * real time down to a lower frame rate.
   */
  readonly maxSimulationDeltaSeconds?: number;
}

/**
 * Drives fixed simulation steps and per-frame updates from a FrameScheduler.
 * The per-frame path does not allocate.
 */
export class GameLoop {
  private handle: number | null = null;
  private previousTimestampMs: number | null = null;

  constructor(
    private readonly scheduler: FrameScheduler,
    private readonly timestep: FixedTimestep,
    private readonly handlers: GameLoopHandlers,
    private readonly options: GameLoopOptions,
  ) {}

  get isRunning(): boolean {
    return this.handle !== null;
  }

  start(): void {
    if (this.handle !== null) {
      return;
    }
    this.previousTimestampMs = null;
    this.timestep.reset();
    this.handle = this.scheduler.request(this.onFrame);
  }

  stop(): void {
    if (this.handle === null) {
      return;
    }
    this.scheduler.cancel(this.handle);
    this.handle = null;
  }

  // Bound once so scheduling the next frame does not create a new closure.
  private readonly onFrame = (timestampMs: number): void => {
    const frameHandle = this.handle;
    if (frameHandle === null) {
      return;
    }
    try {
      this.tick(timestampMs, frameHandle);
    } catch (error) {
      this.stop();
      this.handlers.onError(error);
      return;
    }
    // Continue only if no handler stopped or restarted the loop: a restart has already requested its own frame.
    if (this.handle === frameHandle) {
      this.handle = this.scheduler.request(this.onFrame);
    }
  };

  private tick(timestampMs: number, frameHandle: number): void {
    const elapsedSeconds =
      this.previousTimestampMs === null ? 0 : Math.max((timestampMs - this.previousTimestampMs) / 1000, 0);
    this.previousTimestampMs = timestampMs;
    const deltaSeconds = Math.min(elapsedSeconds, this.options.maxFrameDeltaSeconds);

    const steps = this.timestep.advance(
      Math.min(elapsedSeconds, this.options.maxSimulationDeltaSeconds ?? this.options.maxFrameDeltaSeconds),
    );
    for (let i = 0; i < steps; i++) {
      this.handlers.fixedUpdate(this.timestep.stepSeconds);
      if (this.handle !== frameHandle) {
        return; // Stopped or restarted by the handler: abandon the rest of this frame.
      }
    }
    this.handlers.frameUpdate(deltaSeconds, this.timestep.alpha);
  }
}
