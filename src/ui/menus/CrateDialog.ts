import { CRATE_TIERS, type CrateTier } from '../../data/config/GameConfig';
import type { PaintRarity } from '../../data/definitions/PaintDefinition';
import { button, element, setText } from '../dom';
import type { Strings } from '../i18n';
import { icon, withIcon } from '../icons';

export interface CrateActions {
  /**
   * Opens a crate of `tier`: answers what it held, or null when it could not be opened (none left). The crates held
   * then come back through update().
   */
  readonly onOpen: (tier: CrateTier) => CrateShown | null;
  readonly onClose: () => void;
  /** Sound: the crate shakes (0, 1, 2: harder each time), then bursts open, showing `rarity` (null: credits alone). */
  readonly onShake?: (step: number) => void;
  readonly onBurst?: (rarity: PaintRarity | null) => void;
}

/** What a crate held, ready to show. */
export interface CrateShown {
  /** The credits, written as money. */
  readonly credits: string;
  /** The crate colour it gave, or null. */
  readonly paint: { readonly name: string; readonly color: number; readonly rarity: PaintRarity } | null;
}

/** How the crate opens: three shakes, each this long, then the burst; the reward shows this long after it. */
const SHAKE_MS = 330;
const SHAKES = 3;
const REVEAL_MS = 380;
const COINS = 18;
const SPARKS = 14;

/**
 * The company's crates (CrateService), over the company panel or the result:
 * a tile for each tier with how many wait, and the stage, where the chosen
 * crate stands, glowing in its tier's colour. A tap shakes it three times,
 * harder each time, then it bursts: the lid flies off, light wheels behind,
 * coins and sparks fly and the reward pops up (the credits; a crate colour
 * as a swatch, in its rarity's glow). Everything moves by transform and
 * opacity (CSS), stilled where the player asks for less motion.
 */
export class CrateDialog {
  private readonly overlay: HTMLDivElement;
  private readonly tiles = new Map<CrateTier, { readonly node: HTMLButtonElement; readonly count: HTMLSpanElement }>();
  private readonly stage: HTMLDivElement;
  private readonly box: HTMLButtonElement;
  private readonly hint: HTMLParagraphElement;
  private readonly reward: HTMLDivElement;
  private readonly burst: HTMLDivElement;
  private readonly paints: HTMLParagraphElement;
  private readonly again: HTMLButtonElement;
  private readonly empty: HTMLParagraphElement;
  private counts: Readonly<Record<CrateTier, number>> = { bronze: 0, silver: 0, gold: 0 };
  private tier: CrateTier = 'bronze';
  private opening = false;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    private readonly actions: CrateActions,
  ) {
    const document = parent.ownerDocument;
    this.overlay = element(document, 'div', 'screen crates');
    this.overlay.dataset.screen = 'crates';
    this.overlay.hidden = true;
    const panel = element(document, 'div', 'panel crates__panel');
    const head = element(document, 'div', 'crates__head');
    head.append(icon(document, 'crate', 'crates__icon'), element(document, 'h2', 'panel__title', strings.t('crates.title')));

    const tiles = element(document, 'div', 'crates__tiles');
    for (const tier of CRATE_TIERS) {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'crates__tile';
      node.dataset.tier = tier;
      node.dataset.action = 'pick-crate';
      const count = element(document, 'span', 'crates__tile-count');
      count.dataset.value = `crates-${tier}`;
      node.append(icon(document, 'crate', 'crates__tile-icon'), element(document, 'span', 'crates__tile-name', strings.t(`crate.name.${tier}`)), count);
      node.addEventListener('click', () => {
        if (!this.opening) {
          this.pick(tier);
        }
      });
      tiles.append(node);
      this.tiles.set(tier, { node, count });
    }

    this.stage = element(document, 'div', 'crates__stage');
    const rays = element(document, 'div', 'crates__rays');
    rays.setAttribute('aria-hidden', 'true');
    this.box = document.createElement('button');
    this.box.type = 'button';
    this.box.className = 'crate-box';
    this.box.dataset.action = 'open-crate';
    this.box.setAttribute('aria-label', strings.t('crates.openOne'));
    const lid = element(document, 'span', 'crate-box__lid');
    const body = element(document, 'span', 'crate-box__body');
    const lock = element(document, 'span', 'crate-box__lock');
    body.append(lock);
    this.box.append(lid, body);
    this.box.addEventListener('click', () => this.open());
    this.burst = element(document, 'div', 'crates__burst');
    this.burst.setAttribute('aria-hidden', 'true');
    this.reward = element(document, 'div', 'crates__reward');
    this.reward.setAttribute('role', 'status');
    this.stage.append(rays, this.box, this.burst, this.reward);
    this.hint = element(document, 'p', 'crates__hint', strings.t('crates.tap'));
    this.empty = element(document, 'p', 'crates__empty', strings.t('crates.none'));
    this.paints = element(document, 'p', 'crates__paints');
    this.again = withIcon(button(document, 'button--primary crates__again', strings.t('crates.another'), 'open-another', () => this.reset()), 'crate');

    const choices = element(document, 'div', 'crates__choices');
    choices.append(this.again, withIcon(button(document, 'button--secondary', strings.t('settings.close'), 'close-crates', actions.onClose), 'close'));
    panel.append(
      head,
      element(document, 'p', 'crates__intro', strings.t('crates.intro')),
      tiles,
      this.stage,
      this.hint,
      this.empty,
      this.paints,
      choices,
    );
    this.overlay.append(panel);
    parent.append(this.overlay);
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  /** A crate is opening: the dialog stays until it has shown what it held. */
  get isOpening(): boolean {
    return this.opening;
  }

  /**
   * Opens on the crates held now (`counts`), the best tier with one chosen,
   * or `tier` when given; `paintsGot` is the line on the crate colours.
   */
  show(counts: Readonly<Record<CrateTier, number>>, paintsGot: string, tier?: CrateTier): void {
    this.counts = counts;
    setText(this.paints, paintsGot);
    const best = [...CRATE_TIERS].reverse().find((candidate) => counts[candidate] > 0);
    this.overlay.hidden = false;
    this.pick(tier !== undefined && counts[tier] > 0 ? tier : (best ?? 'bronze'));
  }

  /** The crates held changed (one opened elsewhere, one earned): the tiles and the stage follow. */
  update(counts: Readonly<Record<CrateTier, number>>, paintsGot: string): void {
    this.counts = counts;
    setText(this.paints, paintsGot);
    this.showCounts();
  }

  close(): void {
    this.clearTimers();
    this.opening = false;
    this.overlay.hidden = true;
  }

  dispose(): void {
    this.clearTimers();
    this.overlay.remove();
  }

  private pick(tier: CrateTier): void {
    this.tier = tier;
    this.reset();
  }

  /** The chosen crate back on the stage, closed, if there is one. */
  private reset(): void {
    this.clearTimers();
    this.opening = false;
    if (this.counts[this.tier] <= 0) {
      const best = [...CRATE_TIERS].reverse().find((candidate) => this.counts[candidate] > 0);
      if (best !== undefined) {
        this.tier = best;
      }
    }
    this.stage.dataset.tier = this.tier;
    this.stage.dataset.state = 'closed';
    delete this.stage.dataset.rarity;
    this.reward.replaceChildren();
    this.burst.replaceChildren();
    this.showCounts();
  }

  private showCounts(): void {
    for (const [tier, tile] of this.tiles) {
      const count = this.counts[tier];
      setText(tile.count, `×${count}`);
      tile.node.classList.toggle('is-chosen', tier === this.tier);
      tile.node.classList.toggle('is-empty', count === 0);
      tile.node.setAttribute('aria-pressed', String(tier === this.tier));
    }
    const any = CRATE_TIERS.some((tier) => this.counts[tier] > 0);
    const state = this.stage.dataset.state;
    const waiting = state === 'closed' && this.counts[this.tier] > 0;
    this.stage.hidden = !any && state === 'closed';
    this.box.disabled = !waiting;
    this.hint.hidden = !waiting;
    this.empty.hidden = any || state !== 'closed';
    this.again.hidden = state !== 'opened' || !any;
  }

  private open(): void {
    if (this.opening || this.counts[this.tier] <= 0) {
      return;
    }
    const tier = this.tier;
    const shown = this.actions.onOpen(tier);
    if (shown === null) {
      return;
    }
    // The counts follow from the game (update), as the crate opened there.
    this.opening = true;
    this.hint.hidden = true;
    this.box.disabled = true;
    const reduced = this.overlay.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const shakes = reduced ? 0 : SHAKES;
    for (let step = 0; step < shakes; step++) {
      this.later(step * SHAKE_MS, () => {
        this.stage.dataset.state = `shake-${step}`;
        this.actions.onShake?.(step);
      });
    }
    this.later(shakes * SHAKE_MS, () => {
      this.stage.dataset.state = 'burst';
      if (shown.paint !== null) {
        this.stage.dataset.rarity = shown.paint.rarity;
      }
      this.fillBurst(shown.paint?.rarity ?? null);
      this.actions.onBurst?.(shown.paint?.rarity ?? null);
    });
    this.later(shakes * SHAKE_MS + (reduced ? 0 : REVEAL_MS), () => {
      this.showReward(shown);
      this.stage.dataset.state = 'opened';
      this.opening = false;
      this.showCounts();
    });
  }

  private showReward(shown: CrateShown): void {
    const document = this.overlay.ownerDocument;
    const credits = element(document, 'p', 'crates__credits');
    credits.dataset.value = 'crate-credits';
    credits.append(icon(document, 'coins', 'crates__credits-icon'), element(document, 'span', '', shown.credits));
    const cards: HTMLElement[] = [credits];
    if (shown.paint !== null) {
      const paint = element(document, 'div', 'crates__paint');
      paint.dataset.rarity = shown.paint.rarity;
      paint.dataset.value = 'crate-paint';
      const swatch = element(document, 'span', 'crates__swatch');
      swatch.style.setProperty('--rh-swatch', `#${shown.paint.color.toString(16).padStart(6, '0')}`);
      const words = element(document, 'span', 'crates__paint-words');
      words.append(
        element(document, 'span', 'crates__rarity', this.strings.t(`rarity.${shown.paint.rarity}`)),
        element(document, 'span', 'crates__paint-name', this.strings.t('crates.newPaint', { paint: shown.paint.name })),
        element(document, 'span', 'crates__paint-tip', this.strings.t('crates.paintTip')),
      );
      paint.append(swatch, words);
      cards.push(paint);
    }
    this.reward.replaceChildren(...cards);
  }

  /** Coins, and sparks in the rarity's colour, flung out from the crate. */
  private fillBurst(rarity: PaintRarity | null): void {
    const document = this.overlay.ownerDocument;
    const pieces: HTMLElement[] = [];
    for (let index = 0; index < COINS; index++) {
      const angle = (index / COINS) * Math.PI * 2 + (index % 2) * 0.2;
      const reach = 90 + (index % 3) * 26;
      const coin = element(document, 'span', 'daily__coin');
      coin.style.setProperty('--dx', `${Math.round(Math.cos(angle) * reach)}px`);
      coin.style.setProperty('--dy', `${Math.round(Math.sin(angle) * reach * 0.7 - 30)}px`);
      coin.style.setProperty('--delay', `${(index % 4) * 30}ms`);
      pieces.push(coin);
    }
    if (rarity !== null) {
      for (let index = 0; index < SPARKS; index++) {
        const angle = (index / SPARKS) * Math.PI * 2;
        const spark = element(document, 'span', 'crates__spark');
        spark.style.setProperty('--dx', `${Math.round(Math.cos(angle) * 130)}px`);
        spark.style.setProperty('--dy', `${Math.round(Math.sin(angle) * 100)}px`);
        spark.style.setProperty('--delay', `${(index % 5) * 40}ms`);
        pieces.push(spark);
      }
    }
    this.burst.replaceChildren(...pieces);
  }

  private later(ms: number, run: () => void): void {
    this.timers.push(setTimeout(run, ms));
  }

  private clearTimers(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers = [];
  }
}
