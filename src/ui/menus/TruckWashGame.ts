import type { Fraction } from '../../data/units';
import { button, element, setText } from '../dom';
import type { Strings } from '../i18n';

/** How a wash goes on: what the game pays for it, and the way back to the road. */
export interface TruckWashActions {
  /** The scrub is over with `cleanShare` of the dirt off: the game pays what it pays and says what (a line), or null. */
  readonly onFinished: (cleanShare: Fraction) => string | null;
  readonly onClose: () => void;
}

/** The truck's side as drawn: a grid of this many cells across (and as many down as fit) counts what is scrubbed. */
const GRID_COLUMNS = 48;
/** The brush's reach, as a share of the picture's width. */
const BRUSH_SHARE = 0.06;
/** The clock and the share are shown this often, ms. */
const TICK_MS = 200;
const DIRT_COLORS = ['rgb(120 92 62 / 92%)', 'rgb(98 78 55 / 90%)', 'rgb(140 112 80 / 88%)', 'rgb(84 70 52 / 92%)'] as const;

/**
 * The truck wash's scrub (a minigame for the places to visit): the truck's
 * side in its colour under a coat of road dirt; rubbing it (a finger, or the
 * mouse held down) washes the dirt off where the brush goes. Clean enough
 * (`goal`) within the time, or when the time is up, the game is told how
 * clean it got (`onFinished`). Its clock is the player's (`now`, ms).
 */
export class TruckWashGame {
  private readonly overlay: HTMLDivElement;
  private readonly picture: HTMLCanvasElement;
  private readonly dirt: HTMLCanvasElement;
  private readonly clock: HTMLSpanElement;
  private readonly share: HTMLSpanElement;
  private readonly fill: HTMLSpanElement;
  private readonly result: HTMLParagraphElement;
  private readonly again: HTMLButtonElement;
  /** Per grid cell: 1 if the truck is there (dirt to wash), 2 once washed, 0 for the sky round it. */
  private cells = new Uint8Array(0);
  private rows = 0;
  private dirtyCells = 0;
  private washedCells = 0;
  private endsAtMs = 0;
  private goal: Fraction = 1;
  private seconds = 0;
  private paint = '#e8663d';
  private ticker: ReturnType<typeof setInterval> | null = null;
  private scrubbing: { pointerId: number; x: number; y: number } | null = null;
  private finished = false;
  private actions: TruckWashActions | null = null;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    private readonly now: () => number,
    /** Uniform in [0, 1): where the dirt lies. */
    private readonly random: () => number,
  ) {
    const document = parent.ownerDocument;
    this.overlay = element(document, 'div', 'screen truck-wash');
    this.overlay.dataset.screen = 'truckWash';
    this.overlay.hidden = true;
    const panel = element(document, 'div', 'panel truck-wash__panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'truck-wash-title');
    const title = element(document, 'h2', 'panel__title', strings.t('wash.title'));
    title.id = 'truck-wash-title';
    const goal = element(document, 'p', 'truck-wash__goal');
    goal.dataset.value = 'goal';
    const stage = element(document, 'div', 'truck-wash__stage');
    this.picture = document.createElement('canvas');
    this.picture.className = 'truck-wash__picture';
    this.dirt = document.createElement('canvas');
    this.dirt.className = 'truck-wash__dirt';
    stage.append(this.picture, this.dirt);
    const meter = element(document, 'div', 'truck-wash__meter');
    this.clock = element(document, 'span', 'truck-wash__clock');
    this.share = element(document, 'span', 'truck-wash__share');
    this.share.dataset.value = 'clean';
    const bar = element(document, 'span', 'truck-wash__bar');
    this.fill = element(document, 'span', 'truck-wash__fill');
    bar.append(this.fill);
    meter.append(this.clock, bar, this.share);
    this.result = element(document, 'p', 'truck-wash__result');
    this.result.hidden = true;
    this.again = button(document, 'button--secondary', strings.t('wash.again'), 'wash-again', () => this.start());
    this.again.hidden = true;
    const buttons = element(document, 'div', 'truck-wash__buttons');
    buttons.append(this.again, button(document, 'button--ghost', strings.t('puzzle.close'), 'wash-close', () => this.actions?.onClose()));
    panel.append(title, goal, stage, meter, this.result, buttons);
    this.overlay.append(panel);
    parent.append(this.overlay);
    this.dirt.addEventListener('pointerdown', (event) => this.startScrub(event));
    this.dirt.addEventListener('pointermove', (event) => this.scrub(event));
    this.dirt.addEventListener('pointerup', (event) => this.stopScrub(event));
    this.dirt.addEventListener('pointercancel', (event) => this.stopScrub(event));
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  /** Opens the wash for a truck in `paint` (CSS): `goal` of the dirt off within `seconds` earns the tip. */
  open(paint: string, seconds: number, goal: Fraction, actions: TruckWashActions): void {
    this.paint = paint;
    this.seconds = seconds;
    this.goal = goal;
    this.actions = actions;
    const goalLine = this.overlay.querySelector<HTMLElement>('[data-value="goal"]');
    if (goalLine !== null) {
      setText(goalLine, this.strings.t('wash.goal', { percent: this.strings.percent(goal), time: this.strings.duration(seconds) }));
    }
    this.overlay.hidden = false;
    this.start();
  }

  close(): void {
    this.stopTicker();
    this.overlay.hidden = true;
    this.scrubbing = null;
    this.actions = null;
  }

  /** A fresh coat of dirt, and the clock from the top. */
  private start(): void {
    // The canvases at the size they are shown, in device pixels.
    const width = Math.max(240, Math.round(this.dirt.clientWidth || 480));
    const height = Math.round(width * 0.45);
    for (const canvas of [this.picture, this.dirt]) {
      canvas.width = width;
      canvas.height = height;
    }
    drawTruck(this.picture, this.paint);
    this.layDirt();
    this.finished = false;
    this.result.hidden = true;
    this.again.hidden = true;
    this.overlay.classList.remove('is-done');
    this.endsAtMs = this.now() + this.seconds * 1000;
    this.stopTicker();
    this.ticker = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  /** The dirt over the truck's side, and which cells of it there are to wash. */
  private layDirt(): void {
    const { width, height } = this.dirt;
    const context = this.dirt.getContext('2d');
    if (context === null) {
      return;
    }
    context.globalCompositeOperation = 'source-over';
    context.clearRect(0, 0, width, height);
    this.rows = Math.max(1, Math.round((GRID_COLUMNS * height) / width));
    this.cells = new Uint8Array(GRID_COLUMNS * this.rows);
    const shape = this.picture.getContext('2d')?.getImageData(0, 0, width, height).data;
    this.dirtyCells = 0;
    this.washedCells = 0;
    for (let row = 0; row < this.rows; row++) {
      for (let column = 0; column < GRID_COLUMNS; column++) {
        const x = Math.floor(((column + 0.5) / GRID_COLUMNS) * width);
        const y = Math.floor(((row + 0.5) / this.rows) * height);
        if (shape !== undefined && shape[(y * width + x) * 4 + 3]! > 0) {
          this.cells[row * GRID_COLUMNS + column] = 1;
          this.dirtyCells++;
        }
      }
    }
    // Blotches over the truck, kept to its shape.
    context.save();
    context.drawImage(this.picture, 0, 0);
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = DIRT_COLORS[0];
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 260; i++) {
      context.fillStyle = DIRT_COLORS[Math.floor(this.random() * DIRT_COLORS.length)]!;
      context.beginPath();
      context.arc(this.random() * width, this.random() * height, (0.01 + this.random() * 0.04) * width, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  private startScrub(event: PointerEvent): void {
    if (this.finished) {
      return;
    }
    const point = this.pointOf(event);
    this.scrubbing = { pointerId: event.pointerId, x: point.x, y: point.y };
    this.dirt.setPointerCapture(event.pointerId);
    this.wipe(point.x, point.y, point.x, point.y);
    event.preventDefault();
  }

  private scrub(event: PointerEvent): void {
    const scrubbing = this.scrubbing;
    if (scrubbing === null || event.pointerId !== scrubbing.pointerId || this.finished) {
      return;
    }
    const point = this.pointOf(event);
    this.wipe(scrubbing.x, scrubbing.y, point.x, point.y);
    scrubbing.x = point.x;
    scrubbing.y = point.y;
  }

  private stopScrub(event: PointerEvent): void {
    if (this.scrubbing !== null && event.pointerId === this.scrubbing.pointerId) {
      this.scrubbing = null;
    }
  }

  /** The pointer on the dirt's canvas, in its pixels. */
  private pointOf(event: PointerEvent): { x: number; y: number } {
    const box = this.dirt.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / Math.max(1, box.width)) * this.dirt.width,
      y: ((event.clientY - box.top) / Math.max(1, box.height)) * this.dirt.height,
    };
  }

  /** The brush from (x0, y0) to (x1, y1): the dirt there washed off, and its cells counted. */
  private wipe(x0: number, y0: number, x1: number, y1: number): void {
    const context = this.dirt.getContext('2d');
    const { width, height } = this.dirt;
    const reach = BRUSH_SHARE * width;
    if (context !== null) {
      context.globalCompositeOperation = 'destination-out';
      context.lineCap = 'round';
      context.lineWidth = reach * 2;
      context.beginPath();
      context.moveTo(x0, y0);
      context.lineTo(x1, y1);
      context.stroke();
    }
    // The cells whose middles the stroke came within reach of.
    const cellWidth = width / GRID_COLUMNS;
    const cellHeight = height / this.rows;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lengthSquared = dx * dx + dy * dy;
    const fromColumn = Math.max(0, Math.floor((Math.min(x0, x1) - reach) / cellWidth));
    const toColumn = Math.min(GRID_COLUMNS - 1, Math.floor((Math.max(x0, x1) + reach) / cellWidth));
    const fromRow = Math.max(0, Math.floor((Math.min(y0, y1) - reach) / cellHeight));
    const toRow = Math.min(this.rows - 1, Math.floor((Math.max(y0, y1) + reach) / cellHeight));
    for (let row = fromRow; row <= toRow; row++) {
      for (let column = fromColumn; column <= toColumn; column++) {
        const index = row * GRID_COLUMNS + column;
        if (this.cells[index] !== 1) {
          continue;
        }
        const cx = (column + 0.5) * cellWidth;
        const cy = (row + 0.5) * cellHeight;
        const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((cx - x0) * dx + (cy - y0) * dy) / lengthSquared)) : 0;
        const ex = x0 + dx * t - cx;
        const ey = y0 + dy * t - cy;
        if (ex * ex + ey * ey <= reach * reach) {
          this.cells[index] = 2;
          this.washedCells++;
        }
      }
    }
    if (this.cleanShare() >= this.goal) {
      this.finish();
    }
  }

  private cleanShare(): Fraction {
    return this.dirtyCells === 0 ? 1 : this.washedCells / this.dirtyCells;
  }

  /** The clock and the share shown; time up ends the wash. */
  private tick(): void {
    const left = Math.max(0, (this.endsAtMs - this.now()) / 1000);
    setText(this.clock, this.strings.duration(Math.ceil(left)));
    const share = this.cleanShare();
    setText(this.share, this.strings.percent(share));
    this.fill.style.transform = `scaleX(${Math.min(1, share / this.goal)})`;
    if (left <= 0 && !this.finished) {
      this.finish();
    }
  }

  /** Over: the game told how clean the truck got, the result shown. */
  private finish(): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.scrubbing = null;
    this.stopTicker();
    const share = this.cleanShare();
    setText(this.share, this.strings.percent(share));
    this.fill.style.transform = `scaleX(${Math.min(1, share / this.goal)})`;
    const clean = share >= this.goal;
    this.overlay.classList.add('is-done');
    this.overlay.classList.toggle('is-clean', clean);
    const paid = this.actions?.onFinished(share) ?? null;
    setText(
      this.result,
      clean ? (paid ?? this.strings.t('wash.clean')) : this.strings.t('wash.timeUp', { percent: this.strings.percent(share) }),
    );
    this.result.hidden = false;
    this.again.hidden = false;
  }

  private stopTicker(): void {
    if (this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }
}

/** The truck's side on `canvas`: a cab and a box body in `paint`, windows, a bumper and wheels, the rest clear. */
function drawTruck(canvas: HTMLCanvasElement, paint: string): void {
  const context = canvas.getContext('2d');
  if (context === null) {
    return;
  }
  const { width: w, height: h } = canvas;
  context.clearRect(0, 0, w, h);
  const wheelY = h * 0.8;
  const wheel = h * 0.11;
  // The box body.
  context.fillStyle = '#e9ecef';
  roundRect(context, w * 0.04, h * 0.12, w * 0.62, h * 0.6, h * 0.03);
  context.fillStyle = paint;
  context.fillRect(w * 0.04, h * 0.52, w * 0.62, h * 0.08);
  // The cab.
  context.fillStyle = paint;
  roundRect(context, w * 0.68, h * 0.22, w * 0.27, h * 0.5, h * 0.06);
  context.fillStyle = '#26323d';
  roundRect(context, w * 0.8, h * 0.28, w * 0.12, h * 0.16, h * 0.02);
  roundRect(context, w * 0.71, h * 0.28, w * 0.07, h * 0.16, h * 0.02);
  // The chassis, the bumper and the wheels.
  context.fillStyle = '#3a4048';
  context.fillRect(w * 0.04, h * 0.7, w * 0.92, h * 0.05);
  context.fillRect(w * 0.93, h * 0.62, w * 0.04, h * 0.1);
  for (const x of [0.16, 0.27, 0.85]) {
    context.fillStyle = '#1d2126';
    context.beginPath();
    context.arc(w * x, wheelY, wheel, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#9aa3ab';
    context.beginPath();
    context.arc(w * x, wheelY, wheel * 0.45, 0, Math.PI * 2);
    context.fill();
  }
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
  context.fill();
}
