import { clamp, dampFactor } from '../../core/math/scalar';
import type { ControlSize, SteeringMode, TiltStatus } from '../../data/config/controls';
import { createVehicleInput, type GearLever, steeringCurve, type VehicleInput } from '../../domain/vehicles/VehicleInput';

/**
 * The on-screen wheel turns this far each way for full steering lock: a third of a turn, so a thumb's small slip is a
 * small part of it. It steers along the response curve (steeringCurve): gently near the middle, all the lock at the end.
 */
const MAX_WHEEL_ANGLE = (120 * Math.PI) / 180;
/**
 * The wheel's rim, as a share of its width. A finger on or outside it turns the wheel as far as it goes round the
 * centre; nearer the hub, by its path along the rim's circle, so a small slip by the hub is no big turn.
 */
const WHEEL_RIM_SHARE = 0.4;
/** How fast a released wheel returns to centre, 1/s. */
const WHEEL_RETURN_RATE = 7;
/** The speed dial's arc is full at this speed. */
const DIAL_MAX_KMH = 100;
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The on-screen steering wheel, drawn as SVG in flat colours: a dark rim edged with hairlines and grooved for the
 * thumbs, three straight spokes, the hub with the amber ring, and the amber mark at the top that shows the lock.
 */
const WHEEL_ART = `
  <circle cx="100" cy="100" r="85" fill="none" stroke="rgb(0 0 0 / 40%)" stroke-width="25"/>
  <circle cx="100" cy="100" r="85" fill="none" stroke="#252a30" stroke-width="19"/>
  <circle cx="100" cy="100" r="85" fill="none" stroke="#2f353c" stroke-width="13" stroke-dasharray="1.6 4.4"/>
  <circle cx="100" cy="100" r="94" fill="none" stroke="rgb(255 255 255 / 16%)" stroke-width="1"/>
  <circle cx="100" cy="100" r="76" fill="none" stroke="rgb(255 255 255 / 10%)" stroke-width="1"/>
  <path d="M 20 93 L 73 89 L 73 111 L 20 107 Z M 180 93 L 127 89 L 127 111 L 180 107 Z M 90 125 L 110 125 L 105 184 L 95 184 Z"
    fill="#2b3036" stroke="rgb(255 255 255 / 10%)" stroke-width="1"/>
  <circle cx="100" cy="100" r="29" fill="#1c2025" stroke="rgb(255 255 255 / 14%)" stroke-width="1"/>
  <circle cx="100" cy="100" r="12.5" fill="none" stroke="#f2a33a" stroke-width="3"/>
  <rect x="95" y="6" width="10" height="18" fill="#f2a33a"/>
`;

/** The tilt steering button: a phone turned like a wheel, between two turning arrows. */
const TILT_ICON = `
  <g transform="rotate(-20 12 12)">
    <rect x="4.5" y="8.5" width="15" height="7" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <circle cx="17" cy="12" r="0.9" fill="currentColor"/>
  </g>
  <path d="M3.5 9.5a9 9 0 0 1 5.5-6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M20.5 14.5a9 9 0 0 1-5.5 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M9.6 1.6 9.4 4.4 6.9 3.3z M14.4 22.4l.2-2.8 2.5 1.1z" fill="currentColor"/>
`;

/** Small gauge icons: a fuel pump and a wrench. */
const FUEL_ICON =
  '<path d="M3 2h7v12H3z M10 5l3 2v5a1 1 0 0 0 2 0V6l-2-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M5 4h3v3H5z" fill="currentColor"/>';
const WRENCH_ICON =
  '<path d="M11.5 2.5a3.5 3.5 0 0 0-3.3 4.6L2.5 12.8l1.7 1.7 5.7-5.7a3.5 3.5 0 0 0 4.6-3.3l-2 1-1.6-1.6z" fill="currentColor"/>';

/** The speed dial: a half-circle track, a tick every 20 km/h inside it, and the arc that fills with speed. */
const DIAL_ART = `
  <path class="dashboard__track" d="M 12 58 A 48 48 0 0 1 108 58"/>
  <path class="dashboard__ticks"
    d="M 17 58 H 21 M 25.21 32.73 L 28.45 35.08 M 46.71 17.11 L 47.95 20.91 M 73.29 17.11 L 72.05 20.91 M 94.79 32.73 L 91.55 35.08 M 103 58 H 99"/>
  <path class="dashboard__fill" d="M 12 58 A 48 48 0 0 1 108 58" pathLength="100"/>
`;

export interface TouchControlsOptions {
  readonly onToggleCamera: () => void;
  /** The horn button held down (true) or let go (false). */
  readonly onHorn: (pressed: boolean) => void;
  /** The tilt button, shown when steering by tilt: recentre it, or allow the motion sensor (iOS). */
  readonly onTilt: () => void;
}

/**
 * On-screen driving controls for phones (spec §30: steering wheel, gas,
 * brake), plus a D/R gear button (in R the gas pedal drives backwards), a
 * camera button, a horn and a speed/gear readout. It is input only:
 * it writes `state`, which the entry point merges with the keyboard every
 * fixed step. Each control tracks its own fingers, so steering and pedals
 * work at the same time with two thumbs.
 *
 * The player picks how to steer (`steering`): the wheel; tilting the phone,
 * which the entry point reads (TiltInput), with the brake moved to the left
 * thumb and a button to recentre; or left and right buttons. `size` scales the
 * wheel, pedals and buttons.
 */
export class TouchControls {
  /** Current driver input from the touch controls. */
  readonly state: VehicleInput = createVehicleInput();
  private readonly root: HTMLDivElement;
  private readonly wheel: HTMLDivElement;
  private readonly dialFill: SVGPathElement;
  private readonly speedLabel: HTMLSpanElement;
  private readonly gearLabel: HTMLSpanElement;
  private readonly fuelGauge: HTMLDivElement;
  private readonly fuelFill: HTMLDivElement;
  private readonly damageGauge: HTMLDivElement;
  private readonly damageFill: HTMLDivElement;
  private readonly tiltButton: HTMLButtonElement;
  private readonly gearButton: HTMLButtonElement;
  private mode: SteeringMode = 'wheel';
  private steerLeft = false;
  private steerRight = false;
  private shownFuelPercent = -1;
  private shownFuelLow = false;
  private shownDamagePercent = -1;
  private wheelAngle = 0;
  private wheelPointer: number | null = null;
  private lastPointerAngle = 0;
  private drawnWheelAngle = Number.NaN;
  private shownSpeed = -1;
  private shownGear = Number.NaN;
  private readonly releaseAll: (() => void)[] = [];

  constructor(parent: HTMLElement, options: TouchControlsOptions) {
    const document = parent.ownerDocument;
    const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] => {
      const node = document.createElement(tag);
      node.className = className;
      return node;
    };

    const art = (className: string, viewBox: string, markup: string): SVGSVGElement => {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', className);
      svg.setAttribute('viewBox', viewBox);
      svg.setAttribute('aria-hidden', 'true');
      svg.innerHTML = markup;
      return svg;
    };

    this.root = element('div', 'touch-controls');
    this.wheel = element('div', 'steering-wheel');
    this.wheel.setAttribute('role', 'slider');
    this.wheel.setAttribute('aria-label', 'Steering wheel');
    this.wheel.append(art('steering-wheel__art', '0 0 200 200', WHEEL_ART));

    const brake = element('button', 'pedal pedal--brake');
    brake.type = 'button';
    brake.setAttribute('aria-label', 'Brake');
    const gas = element('button', 'pedal pedal--gas');
    gas.type = 'button';
    gas.setAttribute('aria-label', 'Gas');
    const pedals = element('div', 'pedals');
    pedals.append(brake, gas);

    // The gear lever: D drives forward, R backwards, both on the gas pedal. A tap switches.
    this.gearButton = element('button', 'gear-button');
    this.gearButton.type = 'button';
    for (const [lever, letter] of [
      ['drive', 'D'],
      ['reverse', 'R'],
    ] as const) {
      const label = element('span', `gear-button__${lever}`);
      label.textContent = letter;
      this.gearButton.append(label);
    }
    this.gearButton.addEventListener('click', () => {
      this.gear = this.state.lever === 'reverse' ? 'drive' : 'reverse';
    });

    const dashboard = element('div', 'dashboard');
    const dial = element('div', 'dashboard__dial');
    const dialArt = art('dashboard__arc', '0 0 120 64', DIAL_ART);
    this.dialFill = dialArt.querySelector<SVGPathElement>('.dashboard__fill')!;
    this.speedLabel = element('span', 'dashboard__speed');
    const unit = element('span', 'dashboard__unit');
    unit.textContent = 'km/h';
    dial.append(dialArt, this.speedLabel, unit);
    this.gearLabel = element('span', 'dashboard__gear');
    const gauge = (className: string, icon: string): [HTMLDivElement, HTMLDivElement] => {
      const row = element('div', `dashboard__gauge ${className}`);
      const bar = element('div', 'dashboard__gauge-bar');
      const fill = element('div', 'dashboard__gauge-fill');
      bar.append(fill);
      row.append(art('dashboard__gauge-icon', '0 0 16 16', icon), bar);
      return [row, fill];
    };
    [this.fuelGauge, this.fuelFill] = gauge('dashboard__gauge--fuel', FUEL_ICON);
    [this.damageGauge, this.damageFill] = gauge('dashboard__gauge--damage', WRENCH_ICON);
    const gauges = element('div', 'dashboard__gauges');
    gauges.append(this.fuelGauge, this.damageGauge);
    dashboard.append(dial, this.gearLabel, gauges);

    const camera = element('button', 'camera-button');
    camera.type = 'button';
    camera.setAttribute('aria-label', 'Switch camera');
    camera.addEventListener('click', () => options.onToggleCamera());
    const horn = element('button', 'horn-button');
    horn.type = 'button';
    horn.setAttribute('aria-label', 'Horn');

    const steerButton = (side: 'left' | 'right'): HTMLButtonElement => {
      const control = element('button', `steer-button steer-button--${side}`);
      control.type = 'button';
      control.setAttribute('aria-label', side === 'left' ? 'Steer left' : 'Steer right');
      return control;
    };
    const left = steerButton('left');
    const right = steerButton('right');
    const steerButtons = element('div', 'steer-buttons');
    steerButtons.append(left, right);

    this.tiltButton = element('button', 'tilt-button');
    this.tiltButton.type = 'button';
    this.tiltButton.setAttribute('aria-label', 'Tilt steering: straight ahead');
    this.tiltButton.append(art('tilt-button__icon', '0 0 24 24', TILT_ICON));
    this.tiltButton.addEventListener('click', () => options.onTilt());

    this.root.append(this.wheel, steerButtons, dashboard, pedals, this.gearButton, this.tiltButton, camera, horn);
    // Long presses must not open menus or select anything.
    this.root.addEventListener('contextmenu', (event) => event.preventDefault());
    this.bindWheel();
    this.bindHold(gas, (pressed) => {
      this.state.throttle = pressed ? 1 : 0;
    });
    this.bindHold(brake, (pressed) => {
      this.state.brake = pressed ? 1 : 0;
    });
    this.bindHold(left, (pressed) => {
      this.steerLeft = pressed;
      this.steerByButtons();
    });
    this.bindHold(right, (pressed) => {
      this.steerRight = pressed;
      this.steerByButtons();
    });
    this.bindHold(horn, options.onHorn);
    this.steering = 'wheel';
    this.gear = 'drive';
    this.size = 'normal';
    this.showTilt('off');
    this.showTelemetry(0, 1);
    parent.append(this.root);
  }

  /** Hidden controls also let go of every pedal and the wheel. */
  set visible(visible: boolean) {
    this.root.hidden = !visible;
    if (!visible) {
      this.releaseEverything();
    }
  }

  /** How the player steers; the controls of the other ways hide, and let go. */
  set steering(mode: SteeringMode) {
    this.mode = mode;
    this.root.dataset.steering = mode;
    this.releaseEverything();
    this.wheelAngle = 0;
    this.state.steer = 0;
  }

  set size(size: ControlSize) {
    this.root.dataset.size = size;
  }

  /** The gear lever, D or R (a new drive starts in D). */
  get gear(): GearLever {
    return this.state.lever ?? 'drive';
  }

  set gear(lever: GearLever) {
    const picked = lever === 'reverse' ? 'reverse' : 'drive';
    this.state.lever = picked;
    this.root.dataset.gear = picked;
    this.gearButton.setAttribute('aria-pressed', String(picked === 'reverse'));
    this.gearButton.setAttribute('aria-label', picked === 'reverse' ? 'Gear: reverse (tap for drive)' : 'Gear: drive (tap for reverse)');
  }

  /** Tilt steering's state, on the tilt button: it glows while a tap is needed to allow the motion sensor. */
  showTilt(status: TiltStatus): void {
    this.tiltButton.dataset.status = status;
  }

  /** Per frame: self-centres a released wheel and redraws it only when it moved. */
  update(deltaSeconds: number): void {
    if (this.mode === 'wheel' && this.wheelPointer === null && this.wheelAngle !== 0) {
      this.wheelAngle -= this.wheelAngle * dampFactor(WHEEL_RETURN_RATE, deltaSeconds);
      if (Math.abs(this.wheelAngle) < 0.002) {
        this.wheelAngle = 0;
      }
      this.state.steer = steeringCurve(this.wheelAngle / MAX_WHEEL_ANGLE);
    }
    if (this.wheelAngle !== this.drawnWheelAngle) {
      this.drawnWheelAngle = this.wheelAngle;
      this.wheel.style.transform = `rotate(${this.wheelAngle.toFixed(4)}rad)`;
    }
  }

  /** Shows speed and gear, touching the DOM only when a displayed value changes. */
  showTelemetry(speedKmh: number, gear: number): void {
    const speed = Math.round(Math.abs(speedKmh));
    if (speed !== this.shownSpeed) {
      this.shownSpeed = speed;
      this.speedLabel.textContent = String(speed);
      this.dialFill.style.strokeDashoffset = String(100 - Math.min(1, speed / DIAL_MAX_KMH) * 100);
    }
    if (gear !== this.shownGear) {
      this.shownGear = gear;
      this.gearLabel.textContent = gear < 0 ? 'R' : `D${gear}`;
    }
  }

  /**
   * Shows the fuel level and the truck's damage as small bars. `fuelLow`
   * turns the fuel bar red. The DOM changes only when a whole percent does.
   */
  showCondition(fuelFraction: number, fuelLow: boolean, damage: number): void {
    const fuel = Math.round(Math.min(1, Math.max(0, fuelFraction)) * 100);
    if (fuel !== this.shownFuelPercent) {
      this.shownFuelPercent = fuel;
      this.fuelFill.style.transform = `scaleX(${fuel / 100})`;
      this.fuelGauge.dataset.percent = String(fuel);
    }
    if (fuelLow !== this.shownFuelLow) {
      this.shownFuelLow = fuelLow;
      this.fuelGauge.classList.toggle('is-low', fuelLow);
    }
    const worn = Math.round(Math.min(1, Math.max(0, damage)) * 100);
    if (worn !== this.shownDamagePercent) {
      this.shownDamagePercent = worn;
      this.damageFill.style.transform = `scaleX(${worn / 100})`;
      this.damageGauge.dataset.percent = String(worn);
      this.damageGauge.classList.toggle('is-high', worn > 50);
    }
  }

  dispose(): void {
    this.root.remove();
  }

  private releaseEverything(): void {
    for (const release of this.releaseAll) {
      release();
    }
  }

  /** Left and right held together cancel out. */
  private steerByButtons(): void {
    if (this.mode === 'buttons') {
      this.state.steer = (this.steerRight ? 1 : 0) - (this.steerLeft ? 1 : 0);
    }
  }

  private bindWheel(): void {
    // The finger's distance from the centre over the rim's radius, at the latest angleOf(): 1 on the rim or beyond.
    let rimShare = 1;
    const angleOf = (event: PointerEvent): number => {
      const rect = this.wheel.getBoundingClientRect();
      const x = event.clientX - (rect.left + rect.width / 2);
      const y = event.clientY - (rect.top + rect.height / 2);
      // offsetWidth, not the box's: a turned wheel's box is wider than the wheel.
      rimShare = Math.min(1, Math.sqrt(x * x + y * y) / Math.max(1, this.wheel.offsetWidth * WHEEL_RIM_SHARE));
      // Screen y grows downwards, so the angle grows clockwise, matching steer-right = positive.
      return Math.atan2(y, x);
    };
    const release = (): void => {
      this.wheelPointer = null;
      this.wheel.classList.remove('is-held');
    };
    this.releaseAll.push(release);

    this.wheel.addEventListener('pointerdown', (event) => {
      if (this.wheelPointer !== null) {
        return;
      }
      event.preventDefault();
      this.wheelPointer = event.pointerId;
      this.lastPointerAngle = angleOf(event);
      this.wheel.classList.add('is-held');
      capturePointer(this.wheel, event.pointerId);
    });
    this.wheel.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.wheelPointer || this.mode !== 'wheel') {
        return;
      }
      const angle = angleOf(event);
      let delta = angle - this.lastPointerAngle;
      // Unwrap across ±180° so a full swipe round the rim keeps turning the same way.
      delta = delta > Math.PI ? delta - 2 * Math.PI : delta < -Math.PI ? delta + 2 * Math.PI : delta;
      this.lastPointerAngle = angle;
      this.wheelAngle = clamp(this.wheelAngle + delta * rimShare, -MAX_WHEEL_ANGLE, MAX_WHEEL_ANGLE);
      this.state.steer = steeringCurve(this.wheelAngle / MAX_WHEEL_ANGLE);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      this.wheel.addEventListener(type, (event) => {
        if (event.pointerId === this.wheelPointer) {
          release();
        }
      });
    }
  }

  /** A control held down, a pedal or the horn: it stays down until the last finger on it lifts. */
  private bindHold(control: HTMLButtonElement, setPressed: (pressed: boolean) => void): void {
    const pointers = new Set<number>();
    const release = (): void => {
      pointers.clear();
      control.classList.remove('is-pressed');
      setPressed(false);
    };
    this.releaseAll.push(release);

    control.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      pointers.add(event.pointerId);
      control.classList.add('is-pressed');
      setPressed(true);
      capturePointer(control, event.pointerId);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      control.addEventListener(type, (event) => {
        if (pointers.delete(event.pointerId) && pointers.size === 0) {
          release();
        }
      });
    }
  }
}

/** Keeps receiving a finger's events after it slides off the control. Some synthetic pointers cannot be captured. */
function capturePointer(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Not an active pointer (e.g. a synthetic event): the control still works without capture.
  }
}
