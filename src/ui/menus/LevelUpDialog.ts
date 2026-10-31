import type { CrateTier } from '../../data/config/GameConfig';
import { button, element } from '../dom';
import type { Strings } from '../i18n';
import { icon, withIcon } from '../icons';
import type { IconName } from '../iconShapes';

export interface LevelUpActions {
  /** Collects the level's reward: answers true once paid. */
  readonly onCollect: () => boolean;
  /** Opens the crate the level gave. */
  readonly onOpenCrate: (tier: CrateTier) => void;
  readonly onClose: () => void;
}

/** What a new level unlocks, as a chip: what it is, and how many. */
export interface LevelUnlockShown {
  readonly kind: LevelUnlockKind;
  readonly count: number;
}

export const LEVEL_UNLOCK_KINDS = ['vehicles', 'upgrades', 'missions', 'paints', 'facilities', 'drivers', 'events'] as const;
export type LevelUnlockKind = (typeof LEVEL_UNLOCK_KINDS)[number];

const UNLOCK_ICONS: Readonly<Record<LevelUnlockKind, IconName>> = {
  vehicles: 'truck',
  upgrades: 'wrench',
  missions: 'jobs',
  paints: 'garage',
  facilities: 'office',
  drivers: 'fleet',
  events: 'events',
};

/** A level reached, as the celebration shows it. */
export interface LevelUpShown {
  readonly level: number;
  readonly name: string;
  /** Its reward's credits, written as money, and its crate. */
  readonly credits: string;
  readonly crate: CrateTier;
  readonly unlocks: readonly LevelUnlockShown[];
}

const CONFETTI = 36;
const COINS = 16;
const CONFETTI_COLOURS = ['#f2a33a', '#ffd34d', '#4fc3f7', '#7ed957', '#ff6f91', '#b388ff'];

/**
 * A new company level, celebrated over everything: light wheels behind a big
 * badge with the level's number, which lands with a bounce, under falling
 * confetti; the level's name; its reward (credits and a crate) on two cards;
 * and what it opens up (trucks, upgrades, contracts…). The Collect button
 * pays the reward: coins burst from the cards, and the crate can be opened
 * there and then. Everything moves by transform and opacity (CSS), stilled
 * where the player asks for less motion.
 */
export class LevelUpDialog {
  private readonly overlay: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private shown: LevelUpShown | null = null;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    private readonly actions: LevelUpActions,
  ) {
    const document = parent.ownerDocument;
    this.overlay = element(document, 'div', 'screen level-up');
    this.overlay.dataset.screen = 'levelUp';
    this.overlay.hidden = true;
    this.panel = element(document, 'div', 'level-up__panel');
    this.overlay.append(this.panel);
    parent.append(this.overlay);
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  open(level: LevelUpShown): void {
    this.shown = level;
    const { strings } = this;
    const document = this.overlay.ownerDocument;
    const confetti = element(document, 'div', 'level-up__confetti');
    confetti.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < CONFETTI; index++) {
      const piece = element(document, 'span', 'level-up__piece');
      // Spread evenly across, each its own fall, sway and spin.
      piece.style.setProperty('--x', `${((index * 37) % 100) + 0.5}%`);
      piece.style.setProperty('--sway', `${((index * 53) % 60) - 30}px`);
      piece.style.setProperty('--spin', `${360 + ((index * 97) % 540)}deg`);
      piece.style.setProperty('--delay', `${(index * 83) % 1400}ms`);
      piece.style.setProperty('--fall', `${2400 + ((index * 131) % 1600)}ms`);
      piece.style.setProperty('--colour', CONFETTI_COLOURS[index % CONFETTI_COLOURS.length]!);
      confetti.append(piece);
    }
    const rays = element(document, 'div', 'level-up__rays');
    rays.setAttribute('aria-hidden', 'true');
    const badge = element(document, 'div', 'level-up__badge');
    badge.append(element(document, 'span', 'level-up__badge-word', strings.t('company.level', { level: '' }).trim()));
    const number = element(document, 'span', 'level-up__number', String(level.level));
    number.dataset.value = 'level-up-level';
    badge.append(number);

    const rewards = element(document, 'div', 'level-up__rewards');
    const money = element(document, 'div', 'level-up__reward');
    money.append(icon(document, 'coins', 'level-up__reward-icon'), element(document, 'span', 'level-up__reward-value', level.credits));
    const crate = element(document, 'div', 'level-up__reward level-up__reward--crate');
    crate.dataset.tier = level.crate;
    crate.append(
      icon(document, 'crate', 'level-up__reward-icon'),
      element(document, 'span', 'level-up__reward-value', strings.t(`crate.name.${level.crate}`)),
    );
    rewards.append(money, crate);
    const burst = element(document, 'div', 'level-up__burst');
    burst.setAttribute('aria-hidden', 'true');
    rewards.append(burst);

    const parts: HTMLElement[] = [
      rays,
      element(document, 'p', 'level-up__title', strings.t('levelUp.title')),
      badge,
      element(document, 'p', 'level-up__name', level.name),
      element(document, 'p', 'level-up__heading', strings.t('levelUp.rewards')),
      rewards,
    ];
    if (level.unlocks.length > 0) {
      const unlocks = element(document, 'ul', 'level-up__unlocks');
      for (const unlock of level.unlocks) {
        const chip = element(document, 'li', 'level-up__unlock');
        chip.append(
          icon(document, UNLOCK_ICONS[unlock.kind], 'level-up__unlock-icon'),
          element(document, 'span', '', strings.t(`levelUp.unlock.${unlock.kind}`)),
          element(document, 'span', 'level-up__unlock-count', `+${unlock.count}`),
        );
        unlocks.append(chip);
      }
      parts.push(element(document, 'p', 'level-up__heading', strings.t('levelUp.unlocked')), unlocks);
    }
    const choices = element(document, 'div', 'level-up__choices');
    choices.append(
      withIcon(
        button(document, 'button--primary level-up__collect', strings.t('levelUp.collect'), 'collect-level', () => this.collect(burst, choices)),
        'coins',
      ),
    );
    parts.push(choices);
    this.panel.replaceChildren(...parts);
    this.overlay.replaceChildren(confetti, this.panel);
    this.overlay.classList.remove('is-collected');
    this.overlay.hidden = false;
  }

  close(): void {
    this.overlay.hidden = true;
    this.shown = null;
  }

  dispose(): void {
    this.overlay.remove();
  }

  private collect(burst: HTMLElement, choices: HTMLElement): void {
    const shown = this.shown;
    if (shown === null || !this.actions.onCollect()) {
      return;
    }
    const document = this.overlay.ownerDocument;
    const coins: HTMLElement[] = [];
    for (let index = 0; index < COINS; index++) {
      const angle = (index / COINS) * Math.PI * 2;
      const coin = element(document, 'span', 'daily__coin');
      coin.style.setProperty('--dx', `${Math.round(Math.cos(angle) * 120)}px`);
      coin.style.setProperty('--dy', `${Math.round(Math.sin(angle) * 60 - 20)}px`);
      coin.style.setProperty('--delay', `${(index % 4) * 35}ms`);
      coins.push(coin);
    }
    burst.replaceChildren(...coins);
    this.overlay.classList.add('is-collected');
    choices.replaceChildren(
      withIcon(
        button(document, 'button--primary', this.strings.t('levelUp.openCrate'), 'level-open-crate', () => {
          this.close();
          this.actions.onOpenCrate(shown.crate);
        }),
        'crate',
      ),
      button(document, 'button--secondary', this.strings.t('levelUp.done'), 'close-level', () => {
        this.close();
        this.actions.onClose();
      }),
    );
  }
}
