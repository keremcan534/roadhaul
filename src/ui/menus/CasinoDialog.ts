import type { SlotWinKind } from '../../domain/casino/slotMachine';
import { button, element, setText } from '../dom';
import type { Strings } from '../i18n';
import { icon, withIcon } from '../icons';
import type { IconName } from '../iconShapes';
import { select } from './choiceRow';

export interface CasinoActions {
  /** The player spins for `bet`. */
  readonly onSpin: (bet: number) => void;
  readonly onClose: () => void;
}

/** A spin as the dialog plays it out. */
export interface CasinoSpinShown {
  /** Each reel's symbol: an index into the symbols the dialog was made with. */
  readonly reels: readonly number[];
  readonly kind: SlotWinKind;
  readonly multiplier: number;
  /** What it paid, written as money; with nothing paid, ignored. */
  readonly payout: string;
}

/** A symbol on the reels: its picture, and what it pays. */
export interface CasinoSymbolShown {
  readonly icon: IconName;
  readonly three: number;
  readonly pair: number;
}

/** How the reels run: the first stops after this long, each next one this much later (ms). */
const FIRST_STOP_MS = 900;
const NEXT_STOP_MS = 380;
/** Symbols that pass a window before the one it stops on: more for each reel. */
const PASSING = 16;
const PASSING_PER_REEL = 5;
/** A multiplier this high is a big win: a banner, more coins and the cabinet shakes. */
const BIG_WIN = 10;
/** The bulbs round the marquee. */
const BULBS = 22;
const COINS = 24;

/**
 * The truck stop's slot machine (CasinoService), over the company panel: a
 * cabinet under a marquee of chasing bulbs; three reels on one line, which
 * spin and stop one after the other, settling with a bounce; the bets as
 * chips, a big Spin button, and the credits, with what this sitting has won
 * or lost. A win lights the line and counts up; a big one (ten times the
 * bet) raises a banner, bursts coins and shakes the cabinet, three cups more
 * so. The reels show the line the machine drew: their passing symbols are
 * only for the look. Credits only, and the dialog says so. Everything moves
 * by transform and opacity (CSS), stilled where the player asks for less
 * motion.
 */
export class CasinoDialog {
  private readonly overlay: HTMLDivElement;
  private readonly cabinet: HTMLDivElement;
  private readonly strips: HTMLDivElement[] = [];
  private readonly windows: HTMLDivElement[] = [];
  private readonly message: HTMLParagraphElement;
  private readonly banner: HTMLParagraphElement;
  private readonly burst: HTMLDivElement;
  private readonly credits: HTMLSpanElement;
  private readonly sitting: HTMLSpanElement;
  private readonly betButtons: HTMLButtonElement[] = [];
  private readonly spinButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private bet: number;
  private spinning = false;
  private spins = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Three of the best symbol pay this: the jackpot. */
  private readonly topPay: number;
  /** What each reel shows now, top to bottom: the window's three cells. */
  private readonly shown: number[][] = [];

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    private readonly symbols: readonly CasinoSymbolShown[],
    bets: readonly number[],
    private readonly actions: CasinoActions,
  ) {
    const document = parent.ownerDocument;
    this.bet = bets[0] ?? 0;
    this.topPay = Math.max(...symbols.map((symbol) => symbol.three));
    this.overlay = element(document, 'div', 'screen casino');
    this.overlay.dataset.screen = 'casino';
    this.overlay.hidden = true;
    this.cabinet = element(document, 'div', 'casino__cabinet');
    this.cabinet.setAttribute('role', 'dialog');
    this.cabinet.setAttribute('aria-label', strings.t('casino.title'));

    // The marquee: the name under chasing bulbs.
    const marquee = element(document, 'div', 'casino__marquee');
    const bulbs = element(document, 'div', 'casino__bulbs');
    bulbs.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < BULBS; index++) {
      const bulb = element(document, 'span', 'casino__bulb');
      bulb.style.setProperty('--i', String(index % 3));
      bulbs.append(bulb);
    }
    const title = element(document, 'h2', 'casino__title');
    title.append(icon(document, 'slots', 'casino__title-icon'), element(document, 'span', '', strings.t('casino.title')));
    marquee.append(bulbs, title);

    // The reels behind their glass, the line across them.
    const glass = element(document, 'div', 'casino__glass');
    for (let reel = 0; reel < 3; reel++) {
      const window = element(document, 'div', 'casino__reel');
      const strip = element(document, 'div', 'casino__strip');
      window.append(strip);
      glass.append(window);
      this.windows.push(window);
      this.strips.push(strip);
      const start = [(reel * 2) % symbols.length, (reel * 2 + 1) % symbols.length, (reel * 2 + 2) % symbols.length];
      this.shown.push(start);
      this.fill(strip, start);
    }
    glass.append(element(document, 'span', 'casino__line'));
    this.burst = element(document, 'div', 'casino__burst');
    this.burst.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < COINS; index++) {
      const angle = (index / COINS) * Math.PI * 2;
      const reach = 120 + ((index * 37) % 5) * 28;
      const coin = element(document, 'span', 'casino__coin');
      coin.style.setProperty('--dx', `${Math.round(Math.cos(angle) * reach)}px`);
      coin.style.setProperty('--dy', `${Math.round(Math.sin(angle) * reach * 0.7 - 40)}px`);
      coin.style.setProperty('--delay', `${(index % 6) * 45}ms`);
      this.burst.append(coin);
    }
    glass.append(this.burst);
    this.banner = element(document, 'p', 'casino__banner');
    this.banner.setAttribute('aria-hidden', 'true');
    glass.append(this.banner);

    // What the spin did, and the money.
    this.message = element(document, 'p', 'casino__message', strings.t('casino.ready'));
    this.message.dataset.value = 'casino-result';
    this.message.setAttribute('aria-live', 'polite');
    const money = element(document, 'p', 'casino__money');
    this.credits = element(document, 'span', 'casino__credits');
    this.credits.dataset.value = 'casino-credits';
    this.sitting = element(document, 'span', 'casino__sitting');
    this.sitting.dataset.value = 'casino-sitting';
    money.append(icon(document, 'coins', 'casino__money-icon'), this.credits, this.sitting);

    // The bets and the button.
    const controls = element(document, 'div', 'casino__controls');
    const betRow = element(document, 'div', 'casino__bets');
    betRow.setAttribute('role', 'radiogroup');
    betRow.setAttribute('aria-label', strings.t('casino.bet'));
    betRow.append(element(document, 'span', 'casino__bets-label', strings.t('casino.bet')));
    for (const bet of bets) {
      const chip = button(document, 'casino__chip', strings.number(bet), 'casino-bet', () => this.pickBet(bet));
      chip.setAttribute('role', 'radio');
      chip.dataset.bet = String(bet);
      this.betButtons.push(chip);
      betRow.append(chip);
    }
    this.spinButton = button(document, 'casino__spin', strings.t('casino.spin'), 'casino-spin', () => {
      if (!this.spinning) {
        this.actions.onSpin(this.bet);
      }
    });
    controls.append(betRow, this.spinButton);

    // What pays, and the way out.
    const pays = element(document, 'details', 'casino__pays');
    pays.append(element(document, 'summary', 'casino__pays-title', strings.t('casino.pays')));
    const table = element(document, 'div', 'casino__pay-table');
    for (const symbol of [...symbols].reverse()) {
      const row = element(document, 'div', 'casino__pay-row');
      const three = element(document, 'span', 'casino__pay-icons');
      for (let count = 0; count < 3; count++) {
        three.append(icon(document, symbol.icon, 'casino__pay-icon'));
      }
      row.append(
        three,
        element(document, 'span', 'casino__pay-times', strings.times(symbol.three)),
        element(document, 'span', 'casino__pay-pair', strings.t('casino.pair', { times: strings.times(symbol.pair) })),
      );
      table.append(row);
    }
    pays.append(table);
    this.closeButton = withIcon(button(document, 'button--ghost casino__close', strings.t('settings.close'), 'close-casino', actions.onClose), 'close');
    const foot = element(document, 'div', 'casino__foot');
    foot.append(element(document, 'p', 'casino__note', strings.t('casino.note')), this.closeButton);

    this.cabinet.append(marquee, glass, this.message, money, controls, pays, foot);
    this.overlay.append(this.cabinet);
    parent.append(this.overlay);
    this.pickBet(this.bet);
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  get isSpinning(): boolean {
    return this.spinning;
  }

  /** Opens with the company's credits now (as money) and the sitting's result so far. */
  open(credits: string, sitting: string | null): void {
    this.showMoney(credits, sitting);
    this.overlay.hidden = false;
  }

  /** The credits and the sitting's result, as money; null before the first spin. */
  showMoney(credits: string, sitting: string | null): void {
    setText(this.credits, credits);
    setText(this.sitting, sitting === null ? '' : this.strings.t('casino.sitting', { amount: sitting }));
  }

  /** Plays `spin` out on the reels; `done` once they have all stopped and the win is shown. */
  play(spin: CasinoSpinShown, done: () => void): void {
    this.clearTimer();
    this.spinning = true;
    this.spins += 1;
    this.cabinet.classList.remove('is-win', 'is-big', 'is-jackpot');
    this.cabinet.classList.add('is-spinning');
    this.setControlsEnabled(false);
    setText(this.message, this.strings.t('casino.spinning'));
    setText(this.banner, '');
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // A symbol's cell as the screen draws it (smaller on a short screen): the strip moves this far for each.
    const cellPx = this.windows[0]!.clientHeight / 3;
    let lastStopMs = 0;
    spin.reels.forEach((symbol, reel) => {
      const strip = this.strips[reel]!;
      const passing = PASSING + reel * PASSING_PER_REEL;
      // From what the window shows now, past symbols that only pass, to the line drawn with its neighbours.
      const count = this.symbols.length;
      const above = (symbol + count - 1) % count;
      const below = (symbol + 1) % count;
      const cells = [...this.shown[reel]!];
      for (let index = 0; index < passing; index++) {
        cells.push((this.spins * 3 + reel * 5 + index * 4 + index * index) % count);
      }
      cells.push(above, symbol, below);
      this.shown[reel] = [above, symbol, below];
      strip.style.transition = 'none';
      strip.style.transform = 'translate3d(0, 0, 0)';
      this.fill(strip, cells);
      void strip.offsetHeight; // The strip starts from the top before it runs.
      const stopMs = still ? 150 : FIRST_STOP_MS + reel * NEXT_STOP_MS;
      lastStopMs = stopMs;
      strip.style.transition = `transform ${stopMs}ms cubic-bezier(0.2, 0.75, 0.25, 1.08)`;
      strip.style.transform = `translate3d(0, ${-(cells.length - 3) * cellPx}px, 0)`;
      this.windows[reel]!.classList.remove('is-stopped');
      setTimeout(() => this.windows[reel]!.classList.add('is-stopped'), stopMs);
    });
    this.timer = setTimeout(() => {
      this.timer = null;
      this.spinning = false;
      this.cabinet.classList.remove('is-spinning');
      this.setControlsEnabled(true);
      this.showWin(spin);
      done();
    }, lastStopMs + 60);
  }

  /** The bet can no longer be paid: the chips the credits cannot cover are dimmed. */
  showAffordable(credits: number): void {
    for (const chip of this.betButtons) {
      chip.classList.toggle('is-short', Number(chip.dataset.bet) > credits);
    }
  }

  close(): void {
    this.clearTimer();
    this.spinning = false;
    this.cabinet.classList.remove('is-spinning');
    this.setControlsEnabled(true);
    this.overlay.hidden = true;
  }

  dispose(): void {
    this.clearTimer();
    this.overlay.remove();
  }

  private showWin(spin: CasinoSpinShown): void {
    const { strings } = this;
    if (spin.kind === 'none') {
      setText(this.message, strings.t('casino.noWin'));
      return;
    }
    const big = spin.multiplier >= BIG_WIN;
    const jackpot = spin.kind === 'three' && spin.multiplier >= this.topPay;
    // Restarted: the class goes and comes back after a frame, so the animations run again.
    void this.cabinet.offsetHeight;
    this.cabinet.classList.add('is-win');
    this.cabinet.classList.toggle('is-big', big);
    this.cabinet.classList.toggle('is-jackpot', jackpot);
    setText(
      this.message,
      spin.multiplier === 1 ? strings.t('casino.betBack') : strings.t('casino.won', { amount: spin.payout, times: strings.times(spin.multiplier) }),
    );
    setText(this.banner, jackpot ? strings.t('casino.jackpot') : big ? strings.t('casino.bigWin') : '');
  }

  private pickBet(bet: number): void {
    this.bet = bet;
    for (const chip of this.betButtons) {
      select(chip, Number(chip.dataset.bet) === bet);
    }
  }

  private setControlsEnabled(enabled: boolean): void {
    this.spinButton.disabled = !enabled;
    this.closeButton.disabled = !enabled;
    for (const chip of this.betButtons) {
      chip.disabled = !enabled;
    }
  }

  /** `strip` holding `cells`, a symbol each, top to bottom. */
  private fill(strip: HTMLDivElement, cells: readonly number[]): void {
    const document = strip.ownerDocument;
    strip.replaceChildren(
      ...cells.map((symbol) => {
        const cell = element(document, 'span', 'casino__cell');
        cell.dataset.symbol = String(symbol);
        cell.append(icon(document, this.symbols[symbol]!.icon, 'casino__symbol'));
        return cell;
      }),
    );
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
