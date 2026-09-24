import type { TiltSensitivity, TiltStatus } from '../../data/config/controls';
import { createVehicleInput, type VehicleInput } from '../../domain/vehicles/VehicleInput';
import { TiltSteering } from './TiltSteering';

/** iOS 13+ adds a static permission request to DeviceMotionEvent; the DOM typings do not have it. */
interface MotionSensorAccess {
  readonly requestPermission?: () => Promise<string>;
}

/**
 * Steering by turning the phone (TiltSteering), fed by the browser's
 * `devicemotion` events. It listens only while enabled, and writes `state`
 * (steering only) for the entry point to merge with the other controls.
 * Rotating the screen between portrait and landscape recentres it.
 */
export class TiltInput {
  /** Steering from the phone's tilt; the pedals stay at rest. */
  readonly state: VehicleInput = createVehicleInput();
  private readonly steering: TiltSteering;
  private current: TiltStatus = 'off';
  private listening = false;
  private asking = false;

  constructor(
    private readonly target: Window,
    sensitivity: TiltSensitivity,
    private readonly onStatus: (status: TiltStatus) => void,
  ) {
    this.steering = new TiltSteering(sensitivity);
  }

  get status(): TiltStatus {
    return this.current;
  }

  set sensitivity(sensitivity: TiltSensitivity) {
    this.steering.sensitivity = sensitivity;
  }

  /**
   * Starts steering by tilt. Where the browser asks first (iOS), call it
   * from a tap: it asks at once, and else waits in `locked` for `unlock()`.
   */
  enable(): void {
    if (this.current !== 'off') {
      return;
    }
    const sensor = this.sensor();
    if (sensor === undefined) {
      this.setStatus('unavailable');
    } else if (typeof sensor.requestPermission === 'function') {
      this.setStatus('locked');
      this.unlock();
    } else {
      this.listen();
    }
  }

  /** From a tap: asks the browser for the motion sensor if it still waits for one. */
  unlock(): void {
    const sensor = this.sensor();
    if (this.current !== 'locked' || this.asking || typeof sensor?.requestPermission !== 'function') {
      return;
    }
    this.asking = true;
    sensor.requestPermission().then(
      (answer) => {
        this.asking = false;
        if (this.current === 'locked') {
          if (answer === 'granted') {
            this.listen();
          } else {
            this.setStatus('unavailable');
          }
        }
      },
      () => {
        // Asked outside a tap: it stays locked until the next one.
        this.asking = false;
      },
    );
  }

  /** Stops listening, and lets go of the steering. */
  disable(): void {
    if (this.listening) {
      this.target.removeEventListener('devicemotion', this.onMotion);
      this.screenOrientation()?.removeEventListener('change', this.recenter);
      this.target.removeEventListener('orientationchange', this.recenter);
      this.listening = false;
    }
    this.steering.reset();
    this.state.steer = 0;
    this.setStatus('off');
  }

  /** The phone as it is held now becomes straight ahead. */
  readonly recenter = (): void => {
    this.steering.recenter();
  };

  /** Per frame: eases the steering toward the phone. */
  update(deltaSeconds: number): void {
    if (this.current === 'on') {
      this.steering.update(deltaSeconds);
      this.state.steer = this.steering.steer;
    }
  }

  private listen(): void {
    this.steering.reset();
    this.target.addEventListener('devicemotion', this.onMotion);
    // A turn between portrait and landscape changes which way is up on the screen. Older iOS only has orientationchange.
    this.screenOrientation()?.addEventListener('change', this.recenter);
    this.target.addEventListener('orientationchange', this.recenter);
    this.listening = true;
    this.setStatus('waiting');
  }

  private readonly onMotion = (event: DeviceMotionEvent): void => {
    const gravity = event.accelerationIncludingGravity;
    if (gravity === null || gravity.x === null || gravity.y === null || gravity.z === null) {
      return; // Browsers without a sensor may send one empty event.
    }
    const steers = this.steering.read(gravity.x, gravity.y, gravity.z);
    if (steers !== (this.current === 'on')) {
      if (!steers) {
        this.state.steer = 0;
      }
      this.setStatus(steers ? 'on' : 'waiting');
    }
  };

  private sensor(): MotionSensorAccess | undefined {
    return (this.target as unknown as { DeviceMotionEvent?: MotionSensorAccess }).DeviceMotionEvent;
  }

  /** Older iOS has no screen.orientation. */
  private screenOrientation(): ScreenOrientation | undefined {
    return (this.target.screen as { orientation?: ScreenOrientation } | undefined)?.orientation;
  }

  private setStatus(status: TiltStatus): void {
    if (status !== this.current) {
      this.current = status;
      this.onStatus(status);
    }
  }
}
