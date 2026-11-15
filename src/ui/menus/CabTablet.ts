import { MemoryGame } from '../../domain/games/memoryGame';
import { button, element, setText } from '../dom';
import type { Strings } from '../i18n';
import { icon, type IconName } from '../icons';

/** What the tablet asks of the game. */
export interface CabTabletActions {
  /** A Yard Jam for fun, over the road. */
  readonly onYardJam: () => void;
  readonly onClose: () => void;
}

/** The memory game's faces: the road's things. */
const FACES: readonly IconName[] = ['truck', 'fuel', 'cargo', 'route', 'trophy', 'star', 'crate', 'map'];
/** Two cards that differ stay up this long before they turn back, ms. */
const MISS_SHOWN_MS = 900;

/**
 * The cab's tablet (the owner's card games for auto-drive): beside the road
 * while auto-drive has the wheel, Memory (sixteen cards, the road's
 * things, two turned at a time; MemoryGame) and a way into Yard Jam for
 * fun. Nothing on it pays: it passes the time. It closes when auto-drive
 * gives the wheel back (the entry point closes it).
 */
export class CabTablet {
  private readonly root: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly status: HTMLParagraphElement;
  private readonly again: HTMLButtonElement;
  private cards: HTMLButtonElement[] = [];
  private game: MemoryGame | null = null;
  private missTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    /** Uniform in [0, 1): the deal. */
    private readonly random: () => number,
    actions: CabTabletActions,
  ) {
    const document = parent.ownerDocument;
    this.root = element(document, 'div', 'cab-tablet');
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-labelledby', 'cab-tablet-title');
    const header = element(document, 'div', 'cab-tablet__header');
    const title = element(document, 'h2', 'cab-tablet__title', strings.t('tablet.title'));
    title.id = 'cab-tablet-title';
    const close = button(document, 'button--ghost cab-tablet__close', strings.t('tablet.close'), 'tablet-close', actions.onClose);
    header.append(title, close);
    const memoryTitle = element(document, 'h3', 'cab-tablet__app', strings.t('tablet.memory'));
    const goal = element(document, 'p', 'cab-tablet__goal', strings.t('tablet.memory.goal'));
    this.grid = element(document, 'div', 'cab-tablet__cards');
    this.grid.addEventListener('click', (event) => {
      const card = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('.cab-tablet__card');
      if (card !== null && card !== undefined) {
        this.flip(Number(card.dataset.index));
      }
    });
    this.status = element(document, 'p', 'cab-tablet__status');
    this.status.dataset.value = 'memory';
    this.again = button(document, 'button--secondary cab-tablet__again', strings.t('tablet.memory.again'), 'memory-again', () => this.deal());
    this.again.hidden = true;
    const yardJam = button(document, 'button--secondary cab-tablet__yard-jam', strings.t('tablet.yardJam'), 'tablet-yard-jam', actions.onYardJam);
    this.root.append(header, memoryTitle, goal, this.grid, this.status, this.again, yardJam);
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Opens with a fresh deal, or the game left off if there is one under way. */
  open(): void {
    if (this.game === null || this.game.won) {
      this.deal();
    }
    this.root.hidden = false;
  }

  close(): void {
    this.root.hidden = true;
    if (this.missTimer !== null) {
      clearTimeout(this.missTimer);
      this.missTimer = null;
      this.game?.hideMiss();
      this.show();
    }
  }

  /** A new deal of the eight pairs. */
  private deal(): void {
    if (this.missTimer !== null) {
      clearTimeout(this.missTimer);
      this.missTimer = null;
    }
    this.game = new MemoryGame(FACES.length, Math.floor(this.random() * 2 ** 31));
    const document = this.grid.ownerDocument;
    this.cards = this.game.faces.map((face, index) => {
      const card = element(document, 'button', 'cab-tablet__card');
      card.type = 'button';
      card.dataset.index = String(index);
      card.dataset.face = String(face);
      card.append(icon(document, FACES[face]!, 'cab-tablet__face'));
      return card;
    });
    this.grid.replaceChildren(...this.cards);
    this.show();
  }

  private flip(index: number): void {
    const game = this.game;
    if (game === null || !Number.isInteger(index)) {
      return;
    }
    const result = game.flip(index);
    if (result === 'miss') {
      this.missTimer = setTimeout(() => {
        this.missTimer = null;
        game.hideMiss();
        this.show();
      }, MISS_SHOWN_MS);
    }
    if (result !== 'ignored') {
      this.show();
    }
  }

  /** The cards as they lie, and how the game stands. */
  private show(): void {
    const game = this.game;
    if (game === null) {
      return;
    }
    this.cards.forEach((card, index) => {
      card.classList.toggle('is-up', game.up[index] === 1);
      card.classList.toggle('is-paired', game.paired[index] === 1);
      card.setAttribute('aria-label', game.up[index] === 1 ? this.strings.t('tablet.memory.card', { face: String(game.faces[index]! + 1) }) : this.strings.t('tablet.memory.hidden'));
    });
    setText(
      this.status,
      game.won
        ? this.strings.t('tablet.memory.won', { turns: game.turns })
        : this.strings.t('tablet.memory.status', { pairs: game.pairsFound, total: game.pairs, turns: game.turns }),
    );
    this.root.classList.toggle('is-won', game.won);
    this.again.hidden = !game.won;
  }
}
