import { button, element, setText } from '../dom';
import type { Strings } from '../i18n';
import { icon, withIcon } from '../icons';

export interface DailyRewardActions {
  /** The player collects today's reward. */
  readonly onClaim: () => void;
  /** The player goes on to the road: once it is collected, or leaving it for later. */
  readonly onClose: () => void;
}

/** The daily reward as the dialog shows it. */
export interface DailyRewardShown {
  /** Today's day of the streak, from 1. */
  readonly day: number;
  /** Days in a row with today's. */
  readonly streak: number;
  /** What each day pays, written as money, the first day first. */
  readonly amounts: readonly string[];
}

/** Coins that burst out of today's card as it is collected: how many, and how far they fly (px). */
const COIN_COUNT = 14;
const COIN_REACH_PX = 150;

/**
 * The daily reward (DailyRewardService), offered as a drive starts on the
 * day's first visit: a card for each day of the streak, those already
 * collected ticked, today's lit and the days to come waiting, with today's
 * amount on its button. Collecting it bursts coins out of today's card and
 * counts the streak; then the player drives on. Left for later, it is offered
 * again the next time the game starts, that day. Everything moves by
 * transform and opacity only (CSS), and not at all where the player asks
 * for less motion.
 */
export class DailyRewardDialog {
  private readonly overlay: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly streakLine: HTMLParagraphElement;
  private readonly days: HTMLOListElement;
  private readonly claimButton: HTMLButtonElement;
  private readonly claimLabel: HTMLSpanElement;
  private readonly closeButton: HTMLButtonElement;
  /** Leaves it for now: offered again the next time the game starts, today. */
  private readonly laterButton: HTMLButtonElement;
  private readonly total: HTMLParagraphElement;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    actions: DailyRewardActions,
  ) {
    const document = parent.ownerDocument;
    this.overlay = element(document, 'div', 'screen daily');
    this.overlay.dataset.screen = 'dailyReward';
    this.overlay.hidden = true;
    this.panel = element(document, 'div', 'panel daily__panel');
    const head = element(document, 'div', 'daily__head');
    head.append(icon(document, 'coins', 'daily__icon'), element(document, 'h2', 'panel__title', strings.t('daily.title')));
    this.streakLine = element(document, 'p', 'daily__streak');
    this.streakLine.dataset.value = 'streak';
    this.days = element(document, 'ol', 'daily__days');
    this.total = element(document, 'p', 'daily__total');
    this.total.dataset.value = 'collected';
    this.total.setAttribute('aria-live', 'polite');
    this.claimButton = withIcon(button(document, 'button--primary daily__claim', '', 'claim-daily', actions.onClaim), 'coins');
    this.claimLabel = element(document, 'span', 'daily__claim-label');
    this.claimButton.append(this.claimLabel);
    this.closeButton = withIcon(button(document, 'button--primary daily__claim', strings.t('result.continue'), 'close-daily', actions.onClose), 'play');
    this.closeButton.hidden = true;
    this.laterButton = button(document, 'button--ghost daily__later', strings.t('daily.later'), 'later-daily', actions.onClose);
    this.panel.append(
      head,
      this.streakLine,
      element(document, 'p', 'daily__intro', strings.t('daily.intro')),
      this.days,
      this.total,
      this.claimButton,
      this.closeButton,
      this.laterButton,
    );
    this.overlay.append(this.panel);
    parent.append(this.overlay);
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  /** Opens on today's reward, not yet collected. */
  open(shown: DailyRewardShown): void {
    const { strings } = this;
    const document = this.overlay.ownerDocument;
    this.panel.classList.remove('is-claimed');
    setText(this.streakLine, strings.t('daily.streak', { days: shown.streak }));
    this.days.replaceChildren(
      ...shown.amounts.map((amount, index) => {
        const day = index + 1;
        const card = element(document, 'li', 'daily__day');
        card.dataset.day = String(day);
        card.dataset.state = day < shown.day ? 'done' : day === shown.day ? 'today' : 'later';
        card.append(
          element(document, 'span', 'daily__day-name', strings.t('daily.day', { day })),
          icon(document, day < shown.day ? 'trophy' : 'coins', 'daily__day-icon'),
          element(document, 'span', 'daily__day-amount', amount),
        );
        // The last day brings a crate too (CrateService).
        if (day === shown.amounts.length) {
          card.classList.add('has-crate');
          card.append(icon(document, 'crate', 'daily__day-crate'));
        }
        if (day === shown.day) {
          card.append(this.coins(document));
        }
        return card;
      }),
    );
    setText(this.claimLabel, strings.t('daily.claim', { amount: shown.amounts[shown.day - 1] ?? '' }));
    setText(this.total, '');
    this.claimButton.hidden = false;
    this.claimButton.disabled = false;
    this.laterButton.hidden = false;
    this.closeButton.hidden = true;
    this.overlay.hidden = false;
  }

  /** Today's reward was collected (`amount` as money): the coins burst, and the way on to the road shows. */
  showClaimed(amount: string): void {
    this.panel.classList.add('is-claimed');
    const today = this.days.querySelector<HTMLElement>('[data-state="today"]');
    if (today !== null) {
      today.dataset.state = 'claimed';
    }
    setText(this.total, `+${amount}`);
    this.claimButton.hidden = true;
    this.laterButton.hidden = true;
    this.closeButton.hidden = false;
    this.closeButton.focus({ preventScroll: true });
  }

  close(): void {
    this.overlay.hidden = true;
  }

  dispose(): void {
    this.overlay.remove();
  }

  /** The coins that burst out of today's card, each set off on its own way round the circle. */
  private coins(document: Document): HTMLSpanElement {
    const burst = element(document, 'span', 'daily__burst');
    burst.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < COIN_COUNT; index++) {
      const angle = (index / COIN_COUNT) * Math.PI * 2 + (index % 2) * 0.2;
      const reach = COIN_REACH_PX * (0.6 + 0.4 * ((index * 7) % 5) / 4);
      const coin = element(document, 'span', 'daily__coin');
      coin.style.setProperty('--dx', `${Math.round(Math.cos(angle) * reach)}px`);
      coin.style.setProperty('--dy', `${Math.round(Math.sin(angle) * reach - 30)}px`);
      coin.style.setProperty('--delay', `${(index % 4) * 40}ms`);
      burst.append(coin);
    }
    return burst;
  }
}
