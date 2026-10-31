import { CRATE_TIERS, type CrateTier } from '../../data/config/GameConfig';
import type { BoosterKind } from '../../data/definitions/BoosterKind';
import type { PaintRarity } from '../../data/definitions/PaintDefinition';
import type { QuestMetric } from '../../data/definitions/QuestDefinition';
import { button, element, setText } from '../dom';
import type { Strings } from '../i18n';
import { icon, withIcon } from '../icons';
import type { IconName } from '../iconShapes';

/** The crate dialog's pages: the crates, the day's quests, and the supplies crates gave. */
export const CRATE_PAGES = ['crates', 'quests', 'supplies'] as const;
export type CratePage = (typeof CRATE_PAGES)[number];

/** The boosters the player starts from here; the tokens are used at a pump or a workshop. */
export type StartableBooster = 'pay_boost' | 'xp_boost';

export interface CrateActions {
  /**
   * Opens a crate of `tier`: answers what it held, or null when it could not be opened (none left). The crates held
   * then come back through update().
   */
  readonly onOpen: (tier: CrateTier) => CrateShown | null;
  readonly onClose: () => void;
  /** Collects the free crate, watches an ad for a crate, collects a quest's crate or the bonus, starts a booster. */
  readonly onClaimFree: () => void;
  readonly onAdCrate: () => void;
  readonly onClaimQuest: (questId: string) => void;
  readonly onClaimBonus: () => void;
  readonly onStartBooster: (kind: StartableBooster) => void;
  /** Sound: the crate shakes (0, 1, 2: harder each time), then bursts open, showing `rarity` (null: no colour). */
  readonly onShake?: (step: number) => void;
  readonly onBurst?: (rarity: PaintRarity | null) => void;
}

/** What a crate held, ready to show. */
export interface CrateShown {
  /** The credits, written as money. */
  readonly credits: string;
  /** The crate colour it gave, or null. */
  readonly paint: { readonly name: string; readonly color: number; readonly rarity: PaintRarity } | null;
  /** The crate design it gave (its picture an image URL), or null. */
  readonly livery: { readonly name: string; readonly picture: string; readonly rarity: PaintRarity } | null;
  /** Upgrade parts: 0 for none. */
  readonly parts: number;
  /** A booster, or null. */
  readonly booster: BoosterKind | null;
}

/** A quest of the day, as the dialog shows it. */
export interface QuestShown {
  readonly id: string;
  readonly metric: QuestMetric;
  readonly target: number;
  readonly progress: number;
  readonly done: boolean;
  readonly claimed: boolean;
  readonly crate: CrateTier;
}

/** Everything the dialog shows, from the game. */
export interface CratesShown {
  readonly counts: Readonly<Record<CrateTier, number>>;
  /** The line on the crate colours got. */
  readonly paintsGot: string;
  /** When the free crate is ready, epoch ms (in the past once it is). */
  readonly freeReadyAtMs: number;
  /** The rewarded ad's crate, or null when none can be offered now. */
  readonly ad: { readonly tier: CrateTier; readonly left: number } | null;
  readonly quests: readonly QuestShown[];
  readonly bonus: { readonly crate: CrateTier; readonly ready: boolean; readonly claimed: boolean };
  readonly supplies: {
    readonly parts: number;
    /** What one part takes off an upgrade, written as money. */
    readonly partValue: string;
    readonly boosters: Readonly<Record<BoosterKind, number>>;
    /** Deliveries left on the pay and experience boosts running. */
    readonly payLeft: number;
    readonly xpLeft: number;
    /** The pay boost's share, written as a percentage, and how many deliveries a boost runs for. */
    readonly payShare: string;
    readonly boostDeliveries: number;
  };
}

/** How the crate opens: three shakes, each this long, then the burst; the reward shows this long after it. */
const SHAKE_MS = 330;
const SHAKES = 3;
const REVEAL_MS = 380;
const COINS = 18;
const SPARKS = 14;
/** The crates' slots: this many shown, the rest counted on the last. */
const SLOTS = 4;

const QUEST_ICONS: Readonly<Record<QuestMetric, IconName>> = {
  deliveries: 'jobs',
  perfectDeliveries: 'star',
  onTimeDeliveries: 'clock',
  distanceKm: 'route',
  creditsEarned: 'coins',
  refuels: 'fuel',
  tendersWon: 'rivals',
};

const BOOSTER_ICONS: Readonly<Record<BoosterKind, IconName>> = {
  pay_boost: 'coins',
  xp_boost: 'star',
  free_refuel: 'fuel',
  free_repair: 'wrench',
};

/**
 * The company's crates (CrateService) and what goes with them, over the
 * company panel or the result, on three pages:
 *
 * - Crates: the free crate (collected when ready, else when it will be), a
 *   crate for a rewarded ad (a few a day), the crates held in their slots,
 *   and the stage, where the chosen crate stands glowing in its tier's
 *   colour. A tap shakes it three times, harder each time, then it bursts:
 *   the lid flies off, light wheels behind, coins and sparks fly and the
 *   reward pops up (the credits; parts, a booster; a crate colour as a
 *   swatch, in its rarity's glow).
 * - Quests: the day's three (QuestService), each with its bar and its
 *   crate, collected once done; all three, a bonus crate.
 * - Supplies: the upgrade parts and boosters crates gave (SupplyService),
 *   the pay and experience boosts started here.
 *
 * Everything moves by transform and opacity (CSS), stilled where the player
 * asks for less motion.
 */
export class CrateDialog {
  private readonly overlay: HTMLDivElement;
  private readonly tabs = new Map<CratePage, HTMLButtonElement>();
  private readonly pages = new Map<CratePage, HTMLDivElement>();
  private readonly questsBadge: HTMLSpanElement;
  private readonly freeCard: HTMLDivElement;
  private readonly freeState: HTMLSpanElement;
  private readonly freeButton: HTMLButtonElement;
  private readonly adCard: HTMLDivElement;
  private readonly adState: HTMLSpanElement;
  private readonly adButton: HTMLButtonElement;
  private readonly slots: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly box: HTMLButtonElement;
  private readonly hint: HTMLParagraphElement;
  private readonly reward: HTMLDivElement;
  private readonly burst: HTMLDivElement;
  private readonly paints: HTMLParagraphElement;
  private readonly again: HTMLButtonElement;
  private readonly empty: HTMLParagraphElement;
  private readonly questList: HTMLDivElement;
  private readonly supplyList: HTMLDivElement;
  private shown: CratesShown | null = null;
  private page: CratePage = 'crates';
  private tier: CrateTier = 'bronze';
  private opening = false;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    private readonly actions: CrateActions,
    /** Epoch ms now: the free crate's wait counts down from it. */
    private readonly now: () => number,
  ) {
    const document = parent.ownerDocument;
    this.overlay = element(document, 'div', 'screen crates');
    this.overlay.dataset.screen = 'crates';
    this.overlay.hidden = true;
    const panel = element(document, 'div', 'panel crates__panel');
    const head = element(document, 'div', 'crates__head');
    head.append(icon(document, 'crate', 'crates__icon'), element(document, 'h2', 'panel__title', strings.t('crates.title')));

    const tabBar = element(document, 'div', 'crates__tabs');
    tabBar.setAttribute('role', 'tablist');
    this.questsBadge = element(document, 'span', 'hq__badge');
    this.questsBadge.dataset.value = 'quests-waiting';
    this.questsBadge.hidden = true;
    for (const page of CRATE_PAGES) {
      const tab = button(document, 'crates__tab', strings.t(`crates.page.${page}`), 'crates-page', () => this.select(page));
      tab.dataset.page = page;
      tab.setAttribute('role', 'tab');
      if (page === 'quests') {
        tab.append(this.questsBadge);
      }
      this.tabs.set(page, tab);
      tabBar.append(tab);
    }

    // The crates' page.
    this.freeState = element(document, 'span', 'crates__offer-state');
    this.freeState.dataset.value = 'free-crate';
    this.freeButton = withIcon(
      button(document, 'button--primary crates__offer-button', strings.t('crates.claimFree'), 'claim-free-crate', () =>
        actions.onClaimFree(),
      ),
      'crate',
    );
    this.freeCard = this.offerCard(document, 'clock', strings.t('crates.free'), this.freeState, this.freeButton);
    this.adState = element(document, 'span', 'crates__offer-state');
    this.adButton = withIcon(
      button(document, 'button--secondary crates__offer-button', strings.t('crates.watchAd'), 'ad-crate', () =>
        actions.onAdCrate(),
      ),
      'play',
    );
    this.adCard = this.offerCard(document, 'play', strings.t('crates.adCrate'), this.adState, this.adButton);
    const offers = element(document, 'div', 'crates__offers');
    offers.append(this.freeCard, this.adCard);
    this.slots = element(document, 'div', 'crates__slots');

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
    body.append(element(document, 'span', 'crate-box__lock'));
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
    const cratesPage = element(document, 'div', 'crates__page');
    cratesPage.append(offers, this.slots, this.stage, this.hint, this.empty, this.paints);

    // The quests' page and the supplies' page.
    this.questList = element(document, 'div', 'crates__quests');
    const questsPage = element(document, 'div', 'crates__page');
    questsPage.append(element(document, 'p', 'crates__intro', strings.t('quests.intro')), this.questList);
    this.supplyList = element(document, 'div', 'crates__supplies');
    const suppliesPage = element(document, 'div', 'crates__page');
    suppliesPage.append(element(document, 'p', 'crates__intro', strings.t('supplies.intro')), this.supplyList);
    this.pages.set('crates', cratesPage);
    this.pages.set('quests', questsPage);
    this.pages.set('supplies', suppliesPage);
    for (const [page, node] of this.pages) {
      node.dataset.page = page;
    }

    this.again = withIcon(
      button(document, 'button--primary crates__again', strings.t('crates.another'), 'open-another', () => this.reset()),
      'crate',
    );
    const choices = element(document, 'div', 'crates__choices');
    choices.append(
      this.again,
      withIcon(button(document, 'button--secondary', strings.t('settings.close'), 'close-crates', actions.onClose), 'close'),
    );
    panel.append(head, tabBar, cratesPage, questsPage, suppliesPage, choices);
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

  /** Opens on `page` (the crates by default) with everything as `shown`; on the crates, `tier` chosen if there is one. */
  show(shown: CratesShown, page: CratePage = 'crates', tier?: CrateTier): void {
    this.shown = shown;
    this.overlay.hidden = false;
    const best = [...CRATE_TIERS].reverse().find((candidate) => shown.counts[candidate] > 0);
    this.tier = tier !== undefined && shown.counts[tier] > 0 ? tier : (best ?? 'bronze');
    this.select(page);
    this.reset();
    this.startTicker();
  }

  /** What the game shows changed (a crate opened or earned, a quest done, a booster started): the pages follow. */
  update(shown: CratesShown): void {
    this.shown = shown;
    this.render();
  }

  close(): void {
    this.clearTimers();
    this.stopTicker();
    this.opening = false;
    this.overlay.hidden = true;
  }

  dispose(): void {
    this.clearTimers();
    this.stopTicker();
    this.overlay.remove();
  }

  private select(page: CratePage): void {
    if (this.opening) {
      return;
    }
    this.page = page;
    for (const [name, tab] of this.tabs) {
      tab.classList.toggle('is-chosen', name === page);
      tab.setAttribute('aria-selected', String(name === page));
    }
    for (const [name, node] of this.pages) {
      node.hidden = name !== page;
    }
    this.render();
  }

  private render(): void {
    const shown = this.shown;
    if (shown === null) {
      return;
    }
    const waiting =
      shown.quests.filter((quest) => quest.done && !quest.claimed).length + (shown.bonus.ready && !shown.bonus.claimed ? 1 : 0);
    this.questsBadge.hidden = waiting === 0;
    setText(this.questsBadge, String(waiting));
    setText(this.paints, shown.paintsGot);
    this.showOffers();
    this.showSlots();
    this.showCounts();
    if (this.page === 'quests') {
      this.showQuests();
    } else if (this.page === 'supplies') {
      this.showSupplies();
    }
  }

  private offerCard(
    document: Document,
    iconName: IconName,
    title: string,
    state: HTMLElement,
    action: HTMLButtonElement,
  ): HTMLDivElement {
    const card = element(document, 'div', 'crates__offer');
    const words = element(document, 'span', 'crates__offer-words');
    words.append(element(document, 'span', 'crates__offer-title', title), state);
    card.append(icon(document, iconName, 'crates__offer-icon'), words, action);
    return card;
  }

  private showOffers(): void {
    const shown = this.shown;
    if (shown === null) {
      return;
    }
    const wait = shown.freeReadyAtMs - this.now();
    const ready = wait <= 0;
    this.freeCard.classList.toggle('is-ready', ready);
    this.freeButton.hidden = !ready;
    setText(
      this.freeState,
      ready ? this.strings.t('crates.freeReady') : this.strings.t('crates.freeIn', { time: this.strings.timeSpan(wait) }),
    );
    this.adCard.hidden = shown.ad === null;
    if (shown.ad !== null) {
      const crate = this.strings.t(`crate.name.${shown.ad.tier}`);
      setText(this.adState, this.strings.t('crates.adLeft', { crate, left: shown.ad.left }));
    }
  }

  /** The crates held, a slot each, the best first: the empty slots dashed, the overflow counted on the last. */
  private showSlots(): void {
    const shown = this.shown;
    if (shown === null) {
      return;
    }
    const document = this.overlay.ownerDocument;
    const held: CrateTier[] = [];
    for (const tier of [...CRATE_TIERS].reverse()) {
      for (let i = 0; i < shown.counts[tier]; i++) {
        held.push(tier);
      }
    }
    const cards: HTMLElement[] = [];
    for (let slot = 0; slot < SLOTS; slot++) {
      const tier = held[slot];
      if (tier === undefined) {
        const empty = element(document, 'span', 'crates__slot is-empty');
        empty.append(element(document, 'span', 'crates__slot-name', this.strings.t('crates.emptySlot')));
        cards.push(empty);
        continue;
      }
      const card = button(document, 'crates__slot', '', 'pick-crate', () => {
        if (!this.opening) {
          this.tier = tier;
          this.reset();
        }
      });
      card.dataset.tier = tier;
      card.classList.toggle('is-chosen', tier === this.tier);
      card.replaceChildren(
        icon(document, 'crate', 'crates__slot-icon'),
        element(document, 'span', 'crates__slot-name', this.strings.t(`crate.name.${tier}`)),
      );
      const more = held.length - SLOTS;
      if (slot === SLOTS - 1 && more > 0) {
        card.append(element(document, 'span', 'crates__slot-more', `+${more}`));
      }
      cards.push(card);
    }
    this.slots.replaceChildren(...cards);
  }

  private showQuests(): void {
    const shown = this.shown;
    if (shown === null) {
      return;
    }
    const { strings } = this;
    const document = this.overlay.ownerDocument;
    const rows = shown.quests.map((quest) => {
      const row = element(document, 'div', 'crates__quest');
      row.dataset.quest = quest.id;
      row.dataset.state = quest.claimed ? 'claimed' : quest.done ? 'done' : 'open';
      const bar = element(document, 'span', 'meter crates__quest-bar');
      const fill = element(document, 'span', 'meter__fill');
      fill.style.transform = `scaleX(${quest.target > 0 ? Math.min(1, quest.progress / quest.target) : 0})`;
      bar.append(fill);
      const words = element(document, 'span', 'crates__quest-words');
      words.append(
        element(
          document,
          'span',
          'crates__quest-title',
          strings.t(`quest.metric.${quest.metric}`, { target: strings.number(quest.target) }),
        ),
        bar,
        element(document, 'span', 'crates__quest-count', `${strings.number(quest.progress)} / ${strings.number(quest.target)}`),
      );
      const prize = element(document, 'span', 'crates__quest-prize');
      prize.dataset.tier = quest.crate;
      prize.append(icon(document, 'crate', 'crates__quest-crate'));
      row.append(icon(document, QUEST_ICONS[quest.metric], 'crates__quest-icon'), words, prize);
      if (quest.done && !quest.claimed) {
        row.append(
          button(document, 'button--primary crates__quest-claim', strings.t('quests.claim'), 'claim-quest', () =>
            this.actions.onClaimQuest(quest.id),
          ),
        );
      } else if (quest.claimed) {
        row.append(element(document, 'span', 'goals__done', strings.t('achievements.collected')));
      }
      return row;
    });
    const bonus = element(document, 'div', 'crates__quest crates__quest--bonus');
    bonus.dataset.state = shown.bonus.claimed ? 'claimed' : shown.bonus.ready ? 'done' : 'open';
    const prize = element(document, 'span', 'crates__quest-prize');
    prize.dataset.tier = shown.bonus.crate;
    prize.append(icon(document, 'crate', 'crates__quest-crate'));
    bonus.append(
      icon(document, 'trophy', 'crates__quest-icon'),
      element(document, 'span', 'crates__quest-title', strings.t('quests.bonus', { crate: strings.t(`crate.name.${shown.bonus.crate}`) })),
      prize,
    );
    if (shown.bonus.ready && !shown.bonus.claimed) {
      bonus.append(
        button(document, 'button--primary crates__quest-claim', strings.t('quests.claim'), 'claim-quest-bonus', () =>
          this.actions.onClaimBonus(),
        ),
      );
    } else if (shown.bonus.claimed) {
      bonus.append(element(document, 'span', 'goals__done', strings.t('achievements.collected')));
    }
    this.questList.replaceChildren(...rows, bonus);
  }

  private showSupplies(): void {
    const shown = this.shown;
    if (shown === null) {
      return;
    }
    const { strings } = this;
    const document = this.overlay.ownerDocument;
    const { supplies } = shown;
    const row = (iconName: IconName, title: string, detail: string, count: number, value: string): HTMLDivElement => {
      const node = element(document, 'div', 'crates__supply');
      const words = element(document, 'span', 'crates__supply-words');
      words.append(
        element(document, 'span', 'crates__supply-title', title),
        element(document, 'span', 'crates__supply-detail', detail),
      );
      const amount = element(document, 'span', 'crates__supply-count', `×${count}`);
      amount.dataset.value = value;
      node.append(icon(document, iconName, 'crates__supply-icon'), words, amount);
      node.classList.toggle('is-empty', count === 0);
      return node;
    };
    const partsDetail = strings.t('supplies.partsDetail', { credits: supplies.partValue });
    const rows: HTMLElement[] = [row('wrench', strings.t('supplies.parts'), partsDetail, supplies.parts, 'supply-parts')];
    for (const kind of ['pay_boost', 'xp_boost', 'free_refuel', 'free_repair'] as const) {
      const count = supplies.boosters[kind];
      const detail = strings.t(`booster.${kind}.detail`, { share: supplies.payShare, deliveries: supplies.boostDeliveries });
      const node = row(BOOSTER_ICONS[kind], strings.t(`booster.${kind}.name`), detail, count, `supply-${kind}`);
      if (kind === 'pay_boost' || kind === 'xp_boost') {
        const left = kind === 'pay_boost' ? supplies.payLeft : supplies.xpLeft;
        if (left > 0) {
          node.classList.add('is-running');
          node.append(element(document, 'span', 'crates__supply-running', strings.t('supplies.running', { left })));
        } else if (count > 0) {
          node.append(
            button(document, 'button--primary crates__supply-use', strings.t('supplies.start'), 'start-booster', () =>
              this.actions.onStartBooster(kind),
            ),
          );
        }
      }
      rows.push(node);
    }
    this.supplyList.replaceChildren(...rows);
  }

  /** The chosen crate back on the stage, closed, if there is one. */
  private reset(): void {
    this.clearTimers();
    this.opening = false;
    const shown = this.shown;
    if (shown !== null && shown.counts[this.tier] <= 0) {
      const best = [...CRATE_TIERS].reverse().find((candidate) => shown.counts[candidate] > 0);
      if (best !== undefined) {
        this.tier = best;
      }
    }
    this.stage.dataset.tier = this.tier;
    this.stage.dataset.state = 'closed';
    delete this.stage.dataset.rarity;
    this.reward.replaceChildren();
    this.burst.replaceChildren();
    this.render();
  }

  private showCounts(): void {
    const counts = this.shown?.counts ?? { bronze: 0, silver: 0, gold: 0 };
    const any = CRATE_TIERS.some((tier) => counts[tier] > 0);
    const state = this.stage.dataset.state;
    const waiting = state === 'closed' && counts[this.tier] > 0;
    const onCrates = this.page === 'crates';
    this.stage.hidden = !any && state === 'closed';
    this.box.disabled = !waiting;
    this.hint.hidden = !waiting;
    this.empty.hidden = any || state !== 'closed';
    this.again.hidden = !onCrates || state !== 'opened' || !any;
  }

  private open(): void {
    const counts = this.shown?.counts;
    if (this.opening || counts === undefined || counts[this.tier] <= 0) {
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
      const rarity = shown.paint?.rarity ?? shown.livery?.rarity ?? null;
      if (rarity !== null) {
        this.stage.dataset.rarity = rarity;
      }
      this.fillBurst(rarity);
      this.actions.onBurst?.(rarity);
    });
    this.later(shakes * SHAKE_MS + (reduced ? 0 : REVEAL_MS), () => {
      this.showReward(shown);
      this.stage.dataset.state = 'opened';
      this.opening = false;
      this.render();
    });
  }

  private showReward(shown: CrateShown): void {
    const { strings } = this;
    const document = this.overlay.ownerDocument;
    const credits = element(document, 'p', 'crates__credits');
    credits.dataset.value = 'crate-credits';
    credits.append(icon(document, 'coins', 'crates__credits-icon'), element(document, 'span', '', shown.credits));
    const cards: HTMLElement[] = [credits];
    const extras = element(document, 'div', 'crates__extras');
    if (shown.parts > 0) {
      const parts = element(document, 'span', 'crates__extra');
      parts.dataset.value = 'crate-parts';
      parts.append(
        icon(document, 'wrench', 'crates__extra-icon'),
        element(document, 'span', '', strings.t('crates.gotParts', { count: shown.parts })),
      );
      extras.append(parts);
    }
    if (shown.booster !== null) {
      const booster = element(document, 'span', 'crates__extra');
      booster.dataset.value = 'crate-booster';
      booster.append(
        icon(document, BOOSTER_ICONS[shown.booster], 'crates__extra-icon'),
        element(document, 'span', '', strings.t(`booster.${shown.booster}.name`)),
      );
      extras.append(booster);
    }
    if (extras.childElementCount > 0) {
      cards.push(extras);
    }
    if (shown.paint !== null) {
      const paint = element(document, 'div', 'crates__paint');
      paint.dataset.rarity = shown.paint.rarity;
      paint.dataset.value = 'crate-paint';
      const swatch = element(document, 'span', 'crates__swatch');
      swatch.style.setProperty('--rh-swatch', `#${shown.paint.color.toString(16).padStart(6, '0')}`);
      const words = element(document, 'span', 'crates__paint-words');
      words.append(
        element(document, 'span', 'crates__rarity', strings.t(`rarity.${shown.paint.rarity}`)),
        element(document, 'span', 'crates__paint-name', strings.t('crates.newPaint', { paint: shown.paint.name })),
        element(document, 'span', 'crates__paint-tip', strings.t('crates.paintTip')),
      );
      paint.append(swatch, words);
      cards.push(paint);
    }
    if (shown.livery !== null) {
      const livery = element(document, 'div', 'crates__paint crates__livery');
      livery.dataset.rarity = shown.livery.rarity;
      livery.dataset.value = 'crate-livery';
      const picture = document.createElement('img');
      picture.className = 'crates__livery-picture';
      picture.alt = '';
      picture.src = shown.livery.picture;
      const words = element(document, 'span', 'crates__paint-words');
      words.append(
        element(document, 'span', 'crates__rarity', strings.t(`rarity.${shown.livery.rarity}`)),
        element(document, 'span', 'crates__paint-name', strings.t('crates.newLivery', { livery: shown.livery.name })),
        element(document, 'span', 'crates__paint-tip', strings.t('crates.liveryTip')),
      );
      livery.append(picture, words);
      cards.push(livery);
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

  /** The free crate's wait counts down while the dialog is open: a text change a second. */
  private startTicker(): void {
    this.stopTicker();
    this.ticker = setInterval(() => this.showOffers(), 1000);
  }

  private stopTicker(): void {
    if (this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
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
