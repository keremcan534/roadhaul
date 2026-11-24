/**
 * The GPU's fences, as GpuFrameGate uses them: WebGL2's sync objects in the
 * browser (RenderHost), a fake in the tests.
 */
export interface GpuFences<Fence> {
  /** A fence after the commands given so far; null where there is none to be had (no WebGL2, the context lost). */
  place(): Fence | null;
  /** Whether the GPU has passed `fence`, done with every command before it. Must not wait. */
  passed(fence: Fence): boolean;
  /** Forgets `fence`. */
  remove(fence: Fence): void;
}

/**
 * Frames the GPU may have on hand at once: the one it draws and the one
 * after it. One would leave the GPU idle while the next frame's commands
 * are made; two keep it busy and still keep Android's wait short.
 */
export const FRAMES_IN_FLIGHT = 2;

/**
 * Until a fence has been seen to pass, a frame waits at most this long for
 * the GPU, seconds (from the frame drawn before it), and is then drawn
 * anyway: a driver whose fences never pass would otherwise freeze the
 * picture.
 */
export const GPU_WAIT_LIMIT_SECONDS = 1;

/**
 * Once fences are known to pass, a frame waits up to this long. A GPU that
 * needs more than a second for a frame (a weak one, hot, short of memory)
 * is still drawing: a frame handed to it then only lengthens its queue, and
 * at GPU_WAIT_LIMIT_SECONDS the queue grew by a frame a second for as long
 * as it was that slow, until Android's own drawing waited behind it for
 * five seconds (an ANR). The limit stays for a GPU that never comes back
 * (its context is lost, and `forget` opens the gate then).
 */
export const GPU_WAIT_LIMIT_SLOW_SECONDS = 10;

/**
 * No more than FRAMES_IN_FLIGHT frames on the GPU (ARCHITECTURE.md §11).
 * The browser hands the GPU each frame's commands and goes on. A weak
 * phone's GPU (a PowerVR GE8320, a Mali-G57 MC1) handed frames faster than
 * it draws them keeps a queue of them, seconds long. In the Android app the
 * WebView's GPU thread then waits in the driver for room, Android's own
 * drawing waits for the WebView (its RenderThread, and the main thread in
 * syncAndDrawFrame), and a touch meanwhile goes unanswered. Five seconds of
 * that and Google Play counts an ANR: "Input dispatching timed out", "GPU
 * not responding", 7.46% of the players a day in November 2026, on the
 * Redmi A2+, the Infinix Smart 8, the POCO M4 Pro and a Motorola. A fence
 * after each frame drawn says when the GPU is done with it; the next frame
 * waits for the one before last (ready()), the game running on meanwhile,
 * so Android waits for a frame or two's drawing at most. Allocation-free,
 * but for the fence each frame drawn gets.
 */
export class GpuFrameGate<Fence> {
  /** The fences after the frames still on the GPU, the oldest at `oldest`; null where none waits. */
  private readonly inFlight: (Fence | null)[];
  private oldest = 0;
  /** Whether a fence has been seen to pass: the driver's fences work, and a slow GPU is waited for. */
  private fencesWork = false;
  /** Frames held back for the GPU since the gate was made. */
  heldBack = 0;

  constructor(
    private readonly fences: GpuFences<Fence>,
    framesInFlight = FRAMES_IN_FLIGHT,
  ) {
    this.inFlight = new Array<Fence | null>(Math.max(1, Math.floor(framesInFlight))).fill(null);
  }

  /**
   * Whether a frame may be drawn now: the GPU is done with the oldest frame
   * still on it, or `waitedSeconds` (since the frame drawn last) reached
   * GPU_WAIT_LIMIT_SECONDS (GPU_WAIT_LIMIT_SLOW_SECONDS once fences are
   * known to pass).
   */
  ready(waitedSeconds: number): boolean {
    const fence = this.inFlight[this.oldest] ?? null;
    if (fence === null) {
      return true;
    }
    if (this.fences.passed(fence)) {
      this.fencesWork = true;
    } else if (waitedSeconds < (this.fencesWork ? GPU_WAIT_LIMIT_SLOW_SECONDS : GPU_WAIT_LIMIT_SECONDS)) {
      this.heldBack++;
      return false;
    }
    this.fences.remove(fence);
    this.inFlight[this.oldest] = null;
    return true;
  }

  /** Call once a frame's commands are given: the fence after them. */
  drawn(): void {
    const slot = this.oldest;
    const previous = this.inFlight[slot] ?? null;
    if (previous !== null) {
      this.fences.remove(previous);
    }
    this.inFlight[slot] = this.fences.place();
    this.oldest = (slot + 1) % this.inFlight.length;
  }

  /**
   * Drops every fence without asking the GPU about it: the context they
   * belong to was lost (WebGL then warns of each one asked about or
   * removed in the context restored). The next frames draw at once.
   */
  forget(): void {
    this.inFlight.fill(null);
    this.oldest = 0;
  }

  /** Forgets every fence (the renderer going away). */
  dispose(): void {
    for (let i = 0; i < this.inFlight.length; i++) {
      const fence = this.inFlight[i] ?? null;
      if (fence !== null) {
        this.fences.remove(fence);
        this.inFlight[i] = null;
      }
    }
  }
}
