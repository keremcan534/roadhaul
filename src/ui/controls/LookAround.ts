import { clamp, dampFactor } from '../../core/math/scalar';

/** A drag across the whole screen turns the view this far, radians (half as much up and down). */
const RADIANS_PER_SCREEN = Math.PI;
/** After the finger lifts the view waits this long, seconds… */
const RETURN_DELAY_SECONDS = 0.8;
/** …then turns back to straight ahead at this rate, 1/s. */
const RETURN_RATE = 3;
/** Closer to straight ahead than this (radians) is straight ahead. */
const SNAP = 1e-3;
const POINTER_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'] as const;
type PointerEventType = (typeof POINTER_EVENTS)[number];

/** What LookAround reads of a pointer event. */
export interface LookPointerEvent {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
}

/** What it listens on: the game's canvas (an element is one); a stand-in in the unit tests. */
export interface LookSurface {
  readonly clientWidth: number;
  readonly clientHeight: number;
  addEventListener(type: PointerEventType, listener: (event: LookPointerEvent) => void): void;
  removeEventListener(type: PointerEventType, listener: (event: LookPointerEvent) => void): void;
  setPointerCapture(pointerId: number): void;
}

/**
 * Looking round by dragging a finger (or the mouse) across the road, away
 * from the controls: turn the head in the cabin, swing the chase camera
 * round the truck. One finger at a time; let go, and the view turns back
 * ahead after a moment. It writes `yaw` (radians, right) and `pitch`
 * (radians, up) for the entry point to hand the camera every frame, within
 * the limits the camera gives.
 */
export class LookAround {
  yaw = 0;
  pitch = 0;
  private pointer: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private screenWidth = 1;
  private screenHeight = 1;
  private sinceRelease = Number.POSITIVE_INFINITY;
  private active = false;

  constructor(
    private readonly surface: LookSurface,
    /** The current camera's limits: radians to either side, and up or down. */
    private readonly limits: () => readonly [number, number],
  ) {
    for (const type of POINTER_EVENTS) {
      surface.addEventListener(type, this.listenerFor(type));
    }
  }

  /** Only while driving; turned off, it lets go and faces ahead again. */
  set enabled(enabled: boolean) {
    this.active = enabled;
    if (!enabled) {
      this.reset();
    }
  }

  /** Straight ahead at once (another camera was picked). */
  reset(): void {
    this.pointer = null;
    this.yaw = 0;
    this.pitch = 0;
  }

  /** Per frame: after a drag, turns the view back ahead. */
  update(deltaSeconds: number): void {
    if (this.pointer !== null || (this.yaw === 0 && this.pitch === 0)) {
      return;
    }
    this.sinceRelease += deltaSeconds;
    if (this.sinceRelease < RETURN_DELAY_SECONDS) {
      return;
    }
    const back = dampFactor(RETURN_RATE, deltaSeconds);
    this.yaw -= this.yaw * back;
    this.pitch -= this.pitch * back;
    if (Math.abs(this.yaw) < SNAP && Math.abs(this.pitch) < SNAP) {
      this.yaw = 0;
      this.pitch = 0;
    }
  }

  dispose(): void {
    for (const type of POINTER_EVENTS) {
      this.surface.removeEventListener(type, this.listenerFor(type));
    }
  }

  private listenerFor(type: PointerEventType): (event: LookPointerEvent) => void {
    return type === 'pointerdown' ? this.onDown : type === 'pointermove' ? this.onMove : this.onUp;
  }

  private readonly onDown = (event: LookPointerEvent): void => {
    if (!this.active || this.pointer !== null) {
      return;
    }
    this.pointer = event.pointerId;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.screenWidth = Math.max(1, this.surface.clientWidth);
    this.screenHeight = Math.max(1, this.surface.clientHeight);
    try {
      this.surface.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers cannot be captured; the drag still works over the road.
    }
  };

  private readonly onMove = (event: LookPointerEvent): void => {
    if (event.pointerId !== this.pointer) {
      return;
    }
    const [maxYaw, maxPitch] = this.limits();
    this.yaw = clamp(this.yaw + ((event.clientX - this.lastX) / this.screenWidth) * RADIANS_PER_SCREEN, -maxYaw, maxYaw);
    this.pitch = clamp(
      this.pitch - ((event.clientY - this.lastY) / this.screenHeight) * (RADIANS_PER_SCREEN / 2),
      -maxPitch,
      maxPitch,
    );
    this.lastX = event.clientX;
    this.lastY = event.clientY;
  };

  private readonly onUp = (event: LookPointerEvent): void => {
    if (event.pointerId === this.pointer) {
      this.pointer = null;
      this.sinceRelease = 0;
    }
  };
}
