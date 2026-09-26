import { describe, expect, it } from 'vitest';
import { FixedTimestep } from '../../../../src/core/time/FixedTimestep';
import { GameLoop, type FrameScheduler, type GameLoopHandlers, type GameLoopOptions } from '../../../../src/core/time/GameLoop';

/** Hand-cranked stand-in for requestAnimationFrame. Like the real one, it can hold several requests. */
class FakeScheduler implements FrameScheduler {
  private nextHandle = 1;
  private readonly pending = new Map<number, (timestampMs: number) => void>();

  get pendingCount(): number {
    return this.pending.size;
  }

  request(callback: (timestampMs: number) => void): number {
    const handle = this.nextHandle++;
    this.pending.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.pending.delete(handle);
  }

  /** Runs every callback requested before this frame, at `timestampMs`. */
  frame(timestampMs: number): void {
    if (this.pending.size === 0) {
      throw new Error('No frame was requested.');
    }
    const callbacks = [...this.pending.values()];
    this.pending.clear();
    for (const callback of callbacks) {
      callback(timestampMs);
    }
  }
}

function createLoop(overrides: Partial<GameLoopHandlers> = {}, options: Partial<GameLoopOptions> = {}, maxStepsPerFrame = 5) {
  const scheduler = new FakeScheduler();
  const calls: string[] = [];
  const errors: unknown[] = [];
  const handlers: GameLoopHandlers = {
    fixedUpdate: (stepSeconds) => calls.push(`fixed ${stepSeconds}`),
    frameUpdate: (deltaSeconds, alpha) => calls.push(`frame ${deltaSeconds.toFixed(3)} ${alpha.toFixed(2)}`),
    onError: (error) => errors.push(error),
    ...overrides,
  };
  const loop = new GameLoop(scheduler, new FixedTimestep(0.01, maxStepsPerFrame), handlers, { maxFrameDeltaSeconds: 0.25, ...options });
  return { loop, scheduler, calls, errors };
}

describe('GameLoop', () => {
  it('requests a frame on start and keeps requesting while running', () => {
    const { loop, scheduler } = createLoop();

    loop.start();
    expect(loop.isRunning).toBe(true);
    expect(scheduler.pendingCount).toBe(1);

    scheduler.frame(0);
    expect(scheduler.pendingCount).toBe(1);
  });

  it('starting twice does not request a second frame', () => {
    const { loop, scheduler } = createLoop();
    loop.start();
    loop.start();

    expect(scheduler.pendingCount).toBe(1);
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

  it('catches the simulation up further than the animation where it is asked to: slow drawing, real time', () => {
    const { loop, scheduler, calls } = createLoop({}, { maxSimulationDeltaSeconds: 0.5 }, 60);
    loop.start();
    scheduler.frame(1000);
    calls.length = 0;

    // A 0.4 s frame: all of it simulated, the animation's step clamped as before.
    scheduler.frame(1400);
    expect(calls.filter((call) => call.startsWith('fixed'))).toHaveLength(40);
    expect(calls.at(-1)).toMatch(/^frame 0\.250 /);

    // A long gap: no more than its own cap simulated.
    calls.length = 0;
    scheduler.frame(61_400);
    expect(calls.filter((call) => call.startsWith('fixed'))).toHaveLength(50);
    expect(calls.at(-1)).toMatch(/^frame 0\.250 /);
  });

  it('stop cancels the pending frame and a restart begins with zero elapsed time', () => {
    const { loop, scheduler, calls } = createLoop();
    loop.start();
    scheduler.frame(1000);

    loop.stop();
    expect(loop.isRunning).toBe(false);
    expect(scheduler.pendingCount).toBe(0);

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
    expect(created.scheduler.pendingCount).toBe(0);
  });

  it('keeps a single frame chain when a handler restarts the loop', () => {
    let loop: GameLoop | undefined;
    let frames = 0;
    const created = createLoop({
      frameUpdate: () => {
        frames++;
        if (frames === 1) {
          loop?.stop();
          loop?.start();
        }
      },
    });
    loop = created.loop;
    loop.start();

    created.scheduler.frame(0);
    expect(created.scheduler.pendingCount).toBe(1);

    created.scheduler.frame(16);
    created.scheduler.frame(32);
    expect(frames).toBe(3);
  });

  it('abandons the rest of the frame when fixedUpdate stops the loop', () => {
    let loop: GameLoop | undefined;
    const created = createLoop({
      fixedUpdate: () => {
        created.calls.push('fixed');
        loop?.stop();
      },
    });
    loop = created.loop;
    loop.start();
    created.scheduler.frame(1000);
    created.calls.length = 0;

    // 30 ms at a 10 ms step would normally run three fixed steps and a frame update.
    created.scheduler.frame(1030);

    expect(created.calls).toEqual(['fixed']);
    expect(created.scheduler.pendingCount).toBe(0);
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
    expect(scheduler.pendingCount).toBe(0);
  });
});
