import { describe, expect, it } from 'vitest';
import {
  FRAMES_IN_FLIGHT,
  GPU_WAIT_LIMIT_SECONDS,
  GPU_WAIT_LIMIT_SLOW_SECONDS,
  GpuFrameGate,
  type GpuFences,
} from '../../../src/presentation/GpuFrameGate';

/** A GPU that passes the fences it is told to: each fence is the number of the frame it follows. */
class FakeGpu implements GpuFences<number> {
  placed = 0;
  /** The frames the GPU is done with: every fence up to this one has passed. */
  doneUpTo = 0;
  readonly removed: number[] = [];
  /** Whether fences are to be had at all (WebGL2). */
  constructor(private readonly hasFences = true) {}

  place(): number | null {
    if (!this.hasFences) {
      return null;
    }
    this.placed++;
    return this.placed;
  }

  passed(fence: number): boolean {
    return fence <= this.doneUpTo;
  }

  remove(fence: number): void {
    this.removed.push(fence);
  }
}

describe('GpuFrameGate', () => {
  it('lets the first frames through, up to the frames in flight', () => {
    const gpu = new FakeGpu();
    const gate = new GpuFrameGate(gpu);
    for (let frame = 0; frame < FRAMES_IN_FLIGHT; frame++) {
      expect(gate.ready(0)).toBe(true);
      gate.drawn();
    }
    // The GPU has drawn none of them yet: the next waits.
    expect(gate.ready(0.016)).toBe(false);
    expect(gate.heldBack).toBe(1);
  });

  it('draws the next frame once the GPU is done with the one before last, not before', () => {
    const gpu = new FakeGpu();
    const gate = new GpuFrameGate(gpu, 2);
    gate.drawn(); // frame 1
    gate.drawn(); // frame 2
    expect(gate.ready(0.016)).toBe(false);
    gpu.doneUpTo = 1;
    expect(gate.ready(0.033)).toBe(true);
    expect(gpu.removed).toEqual([1]);
    gate.drawn(); // frame 3: frames 2 and 3 on the GPU
    expect(gate.ready(0.016)).toBe(false);
    gpu.doneUpTo = 2;
    expect(gate.ready(0.016)).toBe(true);
    gate.drawn(); // frame 4
    // The GPU caught up with everything: no wait at all.
    gpu.doneUpTo = 4;
    expect(gate.ready(0)).toBe(true);
    gate.drawn();
    expect(gate.ready(0)).toBe(true);
  });

  it('keeps one frame on the GPU when asked to', () => {
    const gpu = new FakeGpu();
    const gate = new GpuFrameGate(gpu, 1);
    gate.drawn();
    expect(gate.ready(0.016)).toBe(false);
    gpu.doneUpTo = 1;
    expect(gate.ready(0.016)).toBe(true);
  });

  it('draws anyway once a frame has waited too long, so a fence that never passes cannot freeze the picture', () => {
    const gpu = new FakeGpu();
    const gate = new GpuFrameGate(gpu, 1);
    gate.drawn();
    expect(gate.ready(GPU_WAIT_LIMIT_SECONDS - 0.01)).toBe(false);
    expect(gate.ready(GPU_WAIT_LIMIT_SECONDS)).toBe(true);
    expect(gpu.removed).toEqual([1]);
  });

  it('waits for a slow GPU once its fences are known to pass, so its queue does not grow a frame a second', () => {
    const gpu = new FakeGpu();
    const gate = new GpuFrameGate(gpu, 1);
    gate.drawn(); // frame 1
    gpu.doneUpTo = 1;
    expect(gate.ready(0.016)).toBe(true); // A fence passed: the driver's fences work.
    gate.drawn(); // frame 2: the GPU takes seconds over it
    expect(gate.ready(GPU_WAIT_LIMIT_SECONDS)).toBe(false);
    expect(gate.ready(GPU_WAIT_LIMIT_SLOW_SECONDS - 0.01)).toBe(false);
    gpu.doneUpTo = 2;
    expect(gate.ready(GPU_WAIT_LIMIT_SLOW_SECONDS - 0.01)).toBe(true);
    gate.drawn(); // frame 3: a GPU that never comes back is still drawn past, at the longer limit
    expect(gate.ready(GPU_WAIT_LIMIT_SLOW_SECONDS)).toBe(true);
  });

  it('draws every frame where there are no fences (WebGL 1)', () => {
    const gpu = new FakeGpu(false);
    const gate = new GpuFrameGate(gpu);
    for (let frame = 0; frame < 10; frame++) {
      expect(gate.ready(0)).toBe(true);
      gate.drawn();
    }
    expect(gate.heldBack).toBe(0);
    expect(gpu.removed).toEqual([]);
  });

  it('drops a lost context\'s fences without asking the GPU about them, and draws at once', () => {
    const gpu = new FakeGpu();
    const gate = new GpuFrameGate(gpu, 2);
    gate.drawn();
    gate.drawn();
    expect(gate.ready(0)).toBe(false);
    gate.forget();
    expect(gate.ready(0)).toBe(true);
    expect(gpu.removed).toEqual([]);
    // The context restored: fences again, the old ones never asked about.
    gate.drawn();
    gate.drawn();
    expect(gate.ready(0)).toBe(false);
    gpu.doneUpTo = 3;
    expect(gate.ready(0)).toBe(true);
    expect(gpu.removed).toEqual([3]);
  });

  it('removes every fence it placed, none twice', () => {
    const gpu = new FakeGpu();
    const gate = new GpuFrameGate(gpu, 2);
    for (let frame = 1; frame <= 6; frame++) {
      gpu.doneUpTo = frame - 1;
      expect(gate.ready(0)).toBe(true);
      gate.drawn();
    }
    gate.dispose();
    expect([...gpu.removed].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
