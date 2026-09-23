import { describe, expect, it } from 'vitest';
import { FixedTimestep } from '../../../../src/core/time/FixedTimestep';
import { GameLoop, type FrameScheduler, type GameLoopHandlers } from '../../../../src/core/time/GameLoop';

/** Hand-cranked stand-in for requestAnimationFrame. */
class FakeScheduler implements FrameScheduler {
  private nextHandle = 1;
  private pending: { handle: number; callback: (timestampMs: number) => void } | null = null;
  readonly cancelled: number[] = [];

  get hasPendingFrame(): boolean {
    return this.pending !== null;
  }

  request(callback: (timestampMs: number) => void): number {
    const handle = this.nextHandle++;
    this.pending = { handle, callback };
    return handle;
  }

  cancel(handle: number): void {
    this.cancelled.push(handle);
    if (this.pending?.handle === handle) {
      this.pending = null;
    }
  }

  /** Runs the requested frame callback at `timestampMs`. */
  frame(timestampMs: number): void {
    const pending = this.pending;
    if (pending === null) {
      throw new Error('No frame was requested.');
    }
    this.pending = null;
    pending.callback(timestampMs);
  }
}

function createLoop(overrides: Partial<GameLoopHandlers> = {}) {
  const scheduler = new FakeScheduler();
  const calls: string[] = [];
  const errors: unknown[] = [];
  const handlers: GameLoopHandlers = {
    fixedUpdate: (stepSeconds) => calls.push(`fixed ${stepSeconds}`),
    frameUpdate: (deltaSeconds, alpha) => calls.push(`frame ${deltaSeconds.toFixed(3)} ${alpha.toFixed(2)}`),
    onError: (error) => errors.push(error),
    ...overrides,
  };
  const loop = new GameLoop(scheduler, new FixedTimestep(0.01, 5), handlers, { maxFrameDeltaSeconds: 0.25 });
  return { loop, scheduler, calls, errors };
}

describe('GameLoop', () => {
  it('requests a frame on start and keeps requesting while running', () => {
    const { loop, scheduler } = createLoop();

    loop.start();
    expect(loop.isRunning).toBe(true);
    expect(scheduler.hasPendingFrame).toBe(true);

    scheduler.frame(0);
    expect(scheduler.hasPendingFrame).toBe(true);
  });

  it('starting twice does not request a second frame', () => {
    const { loop, scheduler } = createLoop();
    loop.start();
    loop.start();

    scheduler.frame(0);

    expect(scheduler.hasPendingFrame).toBe(true);
  });

  it('treats the first frame after start as zero elapsed time', () => {
    const { loop, scheduler, calls } = createLoop();
    loop.start();

    scheduler.frame(5000);

    expect(calls).toEqual(['frame 0.000 0.00']);
  });

  it('runs the fixed steps for the elapsed time, then one frame update', () => {
    const { loop, scheduler, calls } = createLoop();
    loop.start();
    scheduler.frame(1000);
    calls.length = 0;

    scheduler.frame(1025);

    expect(calls).toEqual(['fixed 0.01', 'fixed 0.01', 'frame 0.025 0.50']);
  });

  it('clamps long frames such as returning from a background tab', () => {
    const { loop, scheduler, calls } = createLoop();
    loop.start();
    scheduler.frame(1000);
    calls.length = 0;

    scheduler.frame(61_000);

    expect(calls.filter((call) => call.startsWith('fixed'))).toHaveLength(5);
    expect(calls.at(-1)).toMatch(/^frame 0\.250 /);
  });

  it('stop cancels the pending frame and a restart begins with zero elapsed time', () => {
    const { loop, scheduler, calls } = createLoop();
    loop.start();
    scheduler.frame(1000);

    loop.stop();
    expect(loop.isRunning).toBe(false);
    expect(scheduler.hasPendingFrame).toBe(false);

    calls.length = 0;
    loop.start();
    scheduler.frame(9000);
    expect(calls).toEqual(['frame 0.000 0.00']);
  });

  it('does not schedule another frame when a handler stops the loop', () => {
    let loop: GameLoop | undefined;
    const created = createLoop({ frameUpdate: () => loop?.stop() });
    loop = created.loop;
    loop.start();

    created.scheduler.frame(0);

    expect(loop.isRunning).toBe(false);
    expect(created.scheduler.hasPendingFrame).toBe(false);
  });

  it('stops and reports the error when a handler throws', () => {
    const failure = new Error('physics exploded');
    const { loop, scheduler, errors } = createLoop({
      fixedUpdate: () => {
        throw failure;
      },
    });
    loop.start();
    scheduler.frame(0);

    scheduler.frame(20);

    expect(errors).toEqual([failure]);
    expect(loop.isRunning).toBe(false);
    expect(scheduler.hasPendingFrame).toBe(false);
  });
});
