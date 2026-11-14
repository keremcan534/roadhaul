import { createVehicleInput, type VehicleInput } from '../../domain/vehicles/VehicleInput';

const STEER_LEFT = new Set(['ArrowLeft', 'KeyA']);
const STEER_RIGHT = new Set(['ArrowRight', 'KeyD']);
const THROTTLE = new Set(['ArrowUp', 'KeyW']);
const BRAKE = new Set(['ArrowDown', 'KeyS', 'Space']);
const CAMERA_TOGGLE = 'KeyC';
const PAUSE = new Set(['Escape', 'KeyP']);
const HORN = 'KeyH';
const MAP = 'KeyM';
const RADIO = 'KeyR';
const SIGNAL_LEFT = 'KeyQ';
const SIGNAL_RIGHT = 'KeyE';
const HAZARDS = 'KeyX';
const PARKING_BRAKE = 'KeyB';
const ENGINE_BRAKE = 'KeyJ';

export interface KeyboardActions {
  readonly onToggleCamera: () => void;
  readonly onPause: () => void;
  /** H held down (true) or let go (false). */
  readonly onHorn: (pressed: boolean) => void;
  /** M: the map, opened or closed. */
  readonly onMap: () => void;
  /** R: the cab radio's next station. */
  readonly onRadio: () => void;
  /** Q or E: the left or the right turn signal, on or off. */
  readonly onSignal: (side: 'left' | 'right') => void;
  /** X: the hazard lights, on or off. */
  readonly onHazards: () => void;
  /** B: the parking brake, applied or released. */
  readonly onParkingBrake: () => void;
  /** J: the engine brake, switched on or off. */
  readonly onEngineBrake: () => void;
}

/**
 * Desktop driving controls: arrows or WASD, Space brakes, C switches camera,
 * H sounds the horn, M opens the map, R tunes the radio, Q and E the turn
 * signals, X the hazard lights, B the parking brake, J the engine brake,
 * Escape or P pauses. Uses physical key codes, so it
 * works the same on Turkish Q/F and other layouts. The truck's steering rate
 * smooths the digital steering.
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
    if (isSwitchKey(event.code)) {
      if (!event.repeat) {
        if (event.code === CAMERA_TOGGLE) {
          this.actions.onToggleCamera();
        } else if (event.code === MAP) {
          this.actions.onMap();
        } else if (event.code === RADIO) {
          this.actions.onRadio();
        } else if (event.code === SIGNAL_LEFT || event.code === SIGNAL_RIGHT) {
          this.actions.onSignal(event.code === SIGNAL_LEFT ? 'left' : 'right');
        } else if (event.code === HAZARDS) {
          this.actions.onHazards();
        } else if (event.code === PARKING_BRAKE) {
          this.actions.onParkingBrake();
        } else if (event.code === ENGINE_BRAKE) {
          this.actions.onEngineBrake();
        } else {
          this.actions.onPause();
        }
      }
      return;
    }
    if (event.code === HORN) {
      if (!event.repeat) {
        this.actions.onHorn(true);
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
    if (event.code === HORN) {
      this.actions.onHorn(false);
    }
    if (this.pressed.delete(event.code)) {
      this.refresh();
    }
  };

  /** Keys released while the window is unfocused never send keyup: let go of everything. */
  private readonly onBlur = (): void => {
    this.pressed.clear();
    this.refresh();
    this.actions.onHorn(false);
  };

  private refresh(): void {
    const any = (keys: ReadonlySet<string>): boolean => [...keys].some((key) => this.pressed.has(key));
    this.state.steer = (any(STEER_RIGHT) ? 1 : 0) - (any(STEER_LEFT) ? 1 : 0);
    this.state.throttle = any(THROTTLE) ? 1 : 0;
    this.state.brake = any(BRAKE) ? 1 : 0;
  }
}

/** A key that does something once as it goes down (held, it does not repeat). */
function isSwitchKey(code: string): boolean {
  return (
    code === CAMERA_TOGGLE ||
    code === MAP ||
    code === RADIO ||
    code === SIGNAL_LEFT ||
    code === SIGNAL_RIGHT ||
    code === HAZARDS ||
    code === PARKING_BRAKE ||
    code === ENGINE_BRAKE ||
    PAUSE.has(code)
  );
}

function isDrivingKey(code: string): boolean {
  return STEER_LEFT.has(code) || STEER_RIGHT.has(code) || THROTTLE.has(code) || BRAKE.has(code);
}

/** True while the player types into a text field. */
export function isTyping(event: Event): boolean {
  const target = event.target as { tagName?: string; isContentEditable?: boolean } | null;
  return target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable === true);
}
