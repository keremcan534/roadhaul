import { createVehicleInput, type VehicleInput } from '../../domain/vehicles/VehicleInput';

const STEER_LEFT = new Set(['ArrowLeft', 'KeyA']);
const STEER_RIGHT = new Set(['ArrowRight', 'KeyD']);
const THROTTLE = new Set(['ArrowUp', 'KeyW']);
const BRAKE = new Set(['ArrowDown', 'KeyS', 'Space']);
const CAMERA_TOGGLE = 'KeyC';
const PAUSE = new Set(['Escape', 'KeyP']);

export interface KeyboardActions {
  readonly onToggleCamera: () => void;
  readonly onPause: () => void;
}

/**
 * Desktop driving controls: arrows or WASD, Space brakes, C switches camera,
 * Escape or P pauses. Uses physical key codes, so it works the same on
 * Turkish Q/F and other layouts. The truck's steering rate smooths the
 * digital steering.
 */
export class KeyboardInput {
  /** Current driver input from the keyboard; read it every fixed step. */
  readonly state: VehicleInput = createVehicleInput();
  private readonly pressed = new Set<string>();

  constructor(
    private readonly target: Window,
    private readonly actions: KeyboardActions,
  ) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTyping(event)) {
      return; // Letters typed into a form (the company name) are not driving.
    }
    if (event.code === CAMERA_TOGGLE || PAUSE.has(event.code)) {
      if (!event.repeat) {
        if (event.code === CAMERA_TOGGLE) {
          this.actions.onToggleCamera();
        } else {
          this.actions.onPause();
        }
      }
      return;
    }
    if (isDrivingKey(event.code)) {
      event.preventDefault(); // Arrows and Space would scroll the page.
      this.pressed.add(event.code);
      this.refresh();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (this.pressed.delete(event.code)) {
      this.refresh();
    }
  };

  /** Keys released while the window is unfocused never send keyup: let go of everything. */
  private readonly onBlur = (): void => {
    this.pressed.clear();
    this.refresh();
  };

  private refresh(): void {
    const any = (keys: ReadonlySet<string>): boolean => [...keys].some((key) => this.pressed.has(key));
    this.state.steer = (any(STEER_RIGHT) ? 1 : 0) - (any(STEER_LEFT) ? 1 : 0);
    this.state.throttle = any(THROTTLE) ? 1 : 0;
    this.state.brake = any(BRAKE) ? 1 : 0;
  }
}

function isDrivingKey(code: string): boolean {
  return STEER_LEFT.has(code) || STEER_RIGHT.has(code) || THROTTLE.has(code) || BRAKE.has(code);
}

/** True while the player types into a text field. */
export function isTyping(event: Event): boolean {
  const target = event.target as { tagName?: string; isContentEditable?: boolean } | null;
  return target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable === true);
}
