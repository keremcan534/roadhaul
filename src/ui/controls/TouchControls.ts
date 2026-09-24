import { clamp, dampFactor } from '../../core/math/scalar';
import { createVehicleInput, type VehicleInput } from '../../domain/vehicles/VehicleInput';

/** The on-screen wheel turns this far each way for full steering lock. */
const MAX_WHEEL_ANGLE = (130 * Math.PI) / 180;
/** How fast a released wheel returns to centre, 1/s. */
const WHEEL_RETURN_RATE = 7;
/** The speed dial's arc is full at this speed. */
const DIAL_MAX_KMH = 100;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** The on-screen steering wheel, drawn as SVG: leather rim with stitching, three spokes, hub and top marker. */
const WHEEL_ART = `
  <defs>
    <linearGradient id="rh-wheel-rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5a6069"/><stop offset="0.45" stop-color="#2c3036"/><stop offset="1" stop-color="#141619"/>
    </linearGradient>
    <radialGradient id="rh-wheel-hub" cx="0.45" cy="0.35" r="0.7">
      <stop offset="0" stop-color="#626973"/><stop offset="1" stop-color="#1b1e22"/>
    </radialGradient>
  </defs>
  <circle cx="100" cy="100" r="85" fill="none" stroke="rgb(0 0 0 / 35%)" stroke-width="24"/>
  <circle cx="100" cy="100" r="85" fill="none" stroke="url(#rh-wheel-rim)" stroke-width="19"/>
  <circle cx="100" cy="100" r="85" fill="none" stroke="rgb(255 255 255 / 22%)" stroke-width="1.2" stroke-dasharray="3 5"/>
  <path d="M 22 94 Q 60 86 76 88 L 76 112 Q 60 114 22 106 Z" fill="#30353b"/>
  <path d="M 178 94 Q 140 86 124 88 L 124 112 Q 140 114 178 106 Z" fill="#30353b"/>
  <path d="M 90 122 L 110 122 L 106 182 L 94 182 Z" fill="#30353b"/>
  <circle cx="100" cy="100" r="30" fill="url(#rh-wheel-hub)" stroke="#0d0f11" stroke-width="2"/>
  <circle cx="100" cy="100" r="13" fill="none" stroke="#f2b233" stroke-width="3.5"/>
  <rect x="93" y="5" width="14" height="20" rx="4" fill="#f2b233"/>
`;

/** Small gauge icons: a fuel pump and a wrench. */
const FUEL_ICON =
  '<path d="M3 2h7v12H3z M10 5l3 2v5a1 1 0 0 0 2 0V6l-2-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M5 4h3v3H5z" fill="currentColor"/>';
const WRENCH_ICON =
  '<path d="M11.5 2.5a3.5 3.5 0 0 0-3.3 4.6L2.5 12.8l1.7 1.7 5.7-5.7a3.5 3.5 0 0 0 4.6-3.3l-2 1-1.6-1.6z" fill="currentColor"/>';

/** The speed dial: a half-circle track and the arc that fills with speed. */
const DIAL_ART = `
  <defs>
    <linearGradient id="rh-dial" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#5fd38a"/><stop offset="0.6" stop-color="#f2b233"/><stop offset="1" stop-color="#f0643c"/>
    </linearGradient>
  </defs>
  <path class="dashboard__track" d="M 12 58 A 48 48 0 0 1 108 58"/>
  <path class="dashboard__fill" d="M 12 58 A 48 48 0 0 1 108 58" pathLength="100"/>
`;

export interface TouchControlsOptions {
  readonly onToggleCamera: () => void;
  /** The horn button held down (true) or let go (false). */
  readonly onHorn: (pressed: boolean) => void;
}

/**
 * On-screen driving controls for phones (spec §30: steering wheel, gas,
 * brake), plus a camera button, a horn and a speed/gear readout. It is input only:
 * it writes `state`, which the entry point merges with the keyboard every
 * fixed step. Each control tracks its own fingers, so steering and pedals
 * work at the same time with two thumbs.
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

    this.root.append(this.wheel, dashboard, pedals, camera, horn);
    // Long presses must not open menus or select anything.
    this.root.addEventListener('contextmenu', (event) => event.preventDefault());
    this.bindWheel();
    this.bindHold(gas, (pressed) => {
      this.state.throttle = pressed ? 1 : 0;
    });
    this.bindHold(brake, (pressed) => {
      this.state.brake = pressed ? 1 : 0;
    });
    this.bindHold(horn, options.onHorn);
    this.showTelemetry(0, 1);
    parent.append(this.root);
  }

  /** Hidden controls also let go of every pedal and the wheel. */
  set visible(visible: boolean) {
    this.root.hidden = !visible;
    if (!visible) {
      for (const release of this.releaseAll) {
        release();
      }
    }
  }

  /** Per frame: self-centres a released wheel and redraws it only when it moved. */
  update(deltaSeconds: number): void {
    if (this.wheelPointer === null && this.wheelAngle !== 0) {
      this.wheelAngle -= this.wheelAngle * dampFactor(WHEEL_RETURN_RATE, deltaSeconds);
      if (Math.abs(this.wheelAngle) < 0.002) {
        this.wheelAngle = 0;
      }
      this.state.steer = this.wheelAngle / MAX_WHEEL_ANGLE;
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

  private bindWheel(): void {
    const angleOf = (event: PointerEvent): number => {
      const rect = this.wheel.getBoundingClientRect();
      // Screen y grows downwards, so the angle grows clockwise, matching steer-right = positive.
      return Math.atan2(event.clientY - (rect.top + rect.height / 2), event.clientX - (rect.left + rect.width / 2));
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
      if (event.pointerId !== this.wheelPointer) {
        return;
      }
      const angle = angleOf(event);
      let delta = angle - this.lastPointerAngle;
      // Unwrap across ±180° so a full swipe round the rim keeps turning the same way.
      delta = delta > Math.PI ? delta - 2 * Math.PI : delta < -Math.PI ? delta + 2 * Math.PI : delta;
      this.lastPointerAngle = angle;
      this.wheelAngle = clamp(this.wheelAngle + delta, -MAX_WHEEL_ANGLE, MAX_WHEEL_ANGLE);
      this.state.steer = this.wheelAngle / MAX_WHEEL_ANGLE;
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
