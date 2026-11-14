import {
  EXIT_ROW,
  isYardCleared,
  slideRange,
  slideVehicle,
  YARD_SIZE,
  type YardJam,
} from '../../domain/puzzles/yardJam';
import { button, element, setText } from '../dom';
import type { Strings } from '../i18n';

/** A yard to clear, and the fewest moves it takes. */
export interface YardJamPuzzle {
  readonly yard: YardJam;
  readonly moves: number;
}

/** How a game of Yard Jam goes on: the day's (with its reward) or one for fun, and what the dialog asks of the game. */
export interface YardJamGame {
  /** The day's yard (it pays once a day), or one for fun. */
  readonly daily: boolean;
  /** The yard cleared in `moves`: the game pays what it pays and says what (a line to show), or null. */
  readonly onCleared: (moves: number) => string | null;
  /** Another yard for fun. */
  readonly onAnother: () => void;
  readonly onClose: () => void;
}

/** A vehicle's colours in the yard, the company's truck first; the rest by turn. */
const TRUCK_COLOR = '#e8663d';
const VEHICLE_COLORS = ['#3f7fd8', '#2bb673', '#f2b233', '#8e6cc6', '#2aa6a0', '#c2525f', '#7a8a96', '#d98c3a'] as const;
/** A drag shorter than this share of a bay moves nothing. */
const LEAST_DRAG_SHARE = 0.35;

/**
 * Yard Jam (the diner's puzzle, src/domain/puzzles/yardJam.ts): the yard's
 * six by six bays, the gate on the right of the truck's row, and the
 * vehicles; a vehicle is dragged along its length as far as the others let
 * it and drops into the nearest bay, a move. Cleared, the truck drives out
 * of the gate and the game is told (`onCleared`). Start again puts the yard
 * back as dealt.
 */
export class YardJamDialog {
  private readonly overlay: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private readonly best: HTMLParagraphElement;
  private readonly board: HTMLDivElement;
  private readonly status: HTMLParagraphElement;
  private readonly reward: HTMLParagraphElement;
  private readonly restart: HTMLButtonElement;
  private readonly another: HTMLButtonElement;
  private vehicles: HTMLDivElement[] = [];
  private dealt: YardJam = [];
  private yard: YardJam = [];
  private moves = 0;
  private cleared = false;
  private game: YardJamGame | null = null;
  /** The drag under way: the vehicle, where the pointer started, the bay's size and how far it may go. */
  private drag: {
    readonly index: number;
    readonly pointerId: number;
    readonly startX: number;
    readonly startY: number;
    readonly cell: number;
    readonly from: number;
    readonly min: number;
    readonly max: number;
    offset: number;
  } | null = null;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
  ) {
    const document = parent.ownerDocument;
    this.overlay = element(document, 'div', 'screen yard-jam');
    this.overlay.dataset.screen = 'yardJam';
    this.overlay.hidden = true;
    const panel = element(document, 'div', 'panel yard-jam__panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'yard-jam-title');
    this.title = element(document, 'h2', 'panel__title yard-jam__title');
    this.title.id = 'yard-jam-title';
    const goal = element(document, 'p', 'yard-jam__goal', strings.t('puzzle.goal'));
    this.best = element(document, 'p', 'yard-jam__best');
    this.board = element(document, 'div', 'yard-jam__board');
    this.board.style.setProperty('--bays', String(YARD_SIZE));
    this.board.style.setProperty('--gate-row', String(EXIT_ROW));
    this.status = element(document, 'p', 'yard-jam__status');
    this.status.dataset.value = 'moves';
    this.reward = element(document, 'p', 'yard-jam__reward');
    this.reward.hidden = true;
    this.restart = button(document, 'button--secondary', strings.t('puzzle.restart'), 'yard-jam-restart', () => this.deal(this.dealt));
    this.another = button(document, 'button--primary', strings.t('puzzle.another'), 'yard-jam-another', () => this.game?.onAnother());
    this.another.hidden = true;
    const buttons = element(document, 'div', 'yard-jam__buttons');
    buttons.append(
      this.restart,
      this.another,
      button(document, 'button--ghost', strings.t('puzzle.close'), 'yard-jam-close', () => this.game?.onClose()),
    );
    panel.append(this.title, goal, this.best, this.board, this.status, this.reward, buttons);
    this.overlay.append(panel);
    parent.append(this.overlay);
    this.board.addEventListener('pointerdown', (event) => this.startDrag(event));
    this.board.addEventListener('pointermove', (event) => this.moveDrag(event));
    this.board.addEventListener('pointerup', (event) => this.endDrag(event));
    this.board.addEventListener('pointercancel', (event) => this.endDrag(event, true));
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  /** Opens with `puzzle`, a game of its kind (`game`). */
  open(puzzle: YardJamPuzzle, game: YardJamGame): void {
    this.game = game;
    setText(this.title, this.strings.t(game.daily ? 'puzzle.daily' : 'puzzle.free'));
    setText(this.best, this.strings.t('puzzle.best', { moves: puzzle.moves }));
    this.reward.hidden = true;
    this.deal(puzzle.yard);
    this.overlay.hidden = false;
  }

  close(): void {
    this.overlay.hidden = true;
    this.drag = null;
    this.game = null;
  }

  /** Lays out `yard` afresh: its vehicles where it has them, no moves yet. */
  private deal(yard: YardJam): void {
    this.dealt = yard;
    this.yard = yard;
    this.moves = 0;
    this.cleared = false;
    this.drag = null;
    this.overlay.classList.remove('is-cleared');
    this.restart.hidden = false;
    this.another.hidden = true;
    const document = this.board.ownerDocument;
    this.vehicles = yard.map((vehicle, index) => {
      const piece = element(document, 'div', `yard-jam__vehicle${index === 0 ? ' yard-jam__vehicle--truck' : ''}`);
      piece.dataset.index = String(index);
      piece.dataset.lies = vehicle.horizontal ? 'along-row' : 'along-column';
      piece.style.setProperty('--length', String(vehicle.length));
      piece.style.setProperty('--paint', index === 0 ? TRUCK_COLOR : VEHICLE_COLORS[(index - 1) % VEHICLE_COLORS.length]!);
      return piece;
    });
    const gate = element(document, 'div', 'yard-jam__gate');
    this.board.replaceChildren(gate, ...this.vehicles);
    this.place();
    this.showMoves();
  }

  /** Each vehicle in its bays. */
  private place(): void {
    this.yard.forEach((vehicle, index) => {
      const piece = this.vehicles[index]!;
      piece.style.setProperty('--row', String(vehicle.row));
      piece.style.setProperty('--col', String(vehicle.col));
      piece.style.transform = '';
    });
  }

  private showMoves(): void {
    setText(this.status, this.strings.t(this.cleared ? 'puzzle.cleared' : 'puzzle.moves', { moves: this.moves }));
  }

  private startDrag(event: PointerEvent): void {
    if (this.cleared || this.drag !== null) {
      return;
    }
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.yard-jam__vehicle');
    const index = Number(target?.dataset.index ?? Number.NaN);
    if (target === null || target === undefined || !Number.isInteger(index)) {
      return;
    }
    const vehicle = this.yard[index]!;
    const range = slideRange(this.yard, index);
    this.drag = {
      index,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cell: this.board.clientWidth / YARD_SIZE,
      from: vehicle.horizontal ? vehicle.col : vehicle.row,
      min: range.min,
      max: range.max,
      offset: 0,
    };
    target.classList.add('is-dragged');
    this.board.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  private moveDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (drag === null || event.pointerId !== drag.pointerId) {
      return;
    }
    const vehicle = this.yard[drag.index]!;
    const pixels = vehicle.horizontal ? event.clientX - drag.startX : event.clientY - drag.startY;
    drag.offset = Math.min(drag.max - drag.from, Math.max(drag.min - drag.from, pixels / drag.cell));
    const shift = `${drag.offset * drag.cell}px`;
    this.vehicles[drag.index]!.style.transform = vehicle.horizontal ? `translateX(${shift})` : `translateY(${shift})`;
  }

  private endDrag(event: PointerEvent, cancelled = false): void {
    const drag = this.drag;
    if (drag === null || event.pointerId !== drag.pointerId) {
      return;
    }
    this.drag = null;
    this.vehicles[drag.index]!.classList.remove('is-dragged');
    const steps = Math.abs(drag.offset) < LEAST_DRAG_SHARE ? 0 : Math.round(drag.offset);
    if (!cancelled && steps !== 0) {
      this.yard = slideVehicle(this.yard, drag.index, drag.from + steps);
      this.moves++;
    }
    this.place();
    if (isYardCleared(this.yard)) {
      this.cleared = true;
      // Out through the gate.
      this.overlay.classList.add('is-cleared');
      const line = this.game?.onCleared(this.moves) ?? null;
      this.reward.hidden = line === null;
      setText(this.reward, line ?? '');
      this.restart.hidden = true;
      this.another.hidden = false;
    }
    this.showMoves();
  }
}
