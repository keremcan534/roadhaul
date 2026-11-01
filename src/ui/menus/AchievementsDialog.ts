import type { AchievementMetric } from '../../data/definitions/AchievementDefinition';
import { button, element } from '../dom';
import type { Strings } from '../i18n';
import { icon, withIcon } from '../icons';
import type { IconName } from '../iconShapes';
import { careerSheet, type CareerShown } from './careerSheet';

/** The dialog's two pages: the goals, and the career's record. */
export type GoalsPage = 'goals' | 'career';

export interface AchievementsActions {
  readonly onClaim: (achievementId: string) => void;
  readonly onClose: () => void;
}

/** A goal as the dialog shows it. */
export interface AchievementShown {
  readonly id: string;
  readonly metric: AchievementMetric;
  readonly target: number;
  readonly progress: number;
  readonly reached: boolean;
  readonly claimed: boolean;
  /** Its reward, written as money. */
  readonly reward: string;
}

/** Each metric's picture. */
const METRIC_ICONS: Readonly<Record<AchievementMetric, IconName>> = {
  deliveries: 'jobs',
  perfectDeliveries: 'careful',
  distanceKm: 'route',
  companyLevel: 'flag',
  trucksOwned: 'truck',
  driversHired: 'fleet',
  facilityLevels: 'office',
  creditsEarned: 'coins',
  tendersWon: 'rivals',
  rivalsBoughtOut: 'megaphone',
  dailyStreak: 'clock',
  upgradesFitted: 'wrench',
  bigWins: 'slots',
  perfectStreak: 'star',
  cratesOpened: 'crate',
  skyWonders: 'eye',
};

const COINS = 10;

/**
 * The company's goals (AchievementService), over the company panel: a card
 * for each, those to collect first (lit, with their button), then those
 * closest to done, then those collected. Each shows what it counts, its
 * target, a bar of the way there and its reward. Collecting one pops its
 * card and bursts coins from it. A second tab shows the career's record
 * (careerSheet).
 */
export class AchievementsDialog {
  private readonly overlay: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private readonly intro: HTMLParagraphElement;
  private readonly list: HTMLDivElement;
  private readonly career: HTMLDivElement;
  private readonly tabs: Readonly<Record<GoalsPage, HTMLButtonElement>>;
  private page: GoalsPage = 'goals';

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    private readonly actions: AchievementsActions,
  ) {
    const document = parent.ownerDocument;
    this.overlay = element(document, 'div', 'screen goals');
    this.overlay.dataset.screen = 'goals';
    this.overlay.hidden = true;
    const panel = element(document, 'div', 'panel goals__panel');
    const head = element(document, 'div', 'goals__head');
    this.title = element(document, 'h2', 'panel__title', strings.t('achievements.title'));
    head.append(icon(document, 'trophy', 'goals__icon'), this.title);
    const tabRow = element(document, 'div', 'goals__tabs');
    tabRow.setAttribute('role', 'tablist');
    const tab = (page: GoalsPage, label: string, picture: IconName): HTMLButtonElement => {
      const node = withIcon(button(document, 'goals__tab', label, 'goals-tab', () => this.showPage(page)), picture);
      node.setAttribute('role', 'tab');
      node.dataset.page = page;
      tabRow.append(node);
      return node;
    };
    this.tabs = { goals: tab('goals', strings.t('career.tab.goals'), 'trophy'), career: tab('career', strings.t('career.tab.career'), 'route') };
    this.intro = element(document, 'p', 'goals__intro', strings.t('achievements.intro'));
    this.list = element(document, 'div', 'goals__list');
    this.career = element(document, 'div', 'goals__list goals__career');
    panel.append(
      head,
      tabRow,
      this.intro,
      this.list,
      this.career,
      withIcon(button(document, 'button--secondary goals__close', strings.t('settings.close'), 'close-goals', actions.onClose), 'close'),
    );
    this.overlay.append(panel);
    parent.append(this.overlay);
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  /** Opens on the goals, the career's record ready on its tab. */
  open(goals: readonly AchievementShown[], career: CareerShown): void {
    this.show(goals);
    this.career.replaceChildren(careerSheet(this.overlay.ownerDocument, this.strings, career));
    this.showPage('goals');
    this.overlay.hidden = false;
  }

  /** The page shown: the goals or the career. */
  get shownPage(): GoalsPage {
    return this.page;
  }

  private showPage(page: GoalsPage): void {
    this.page = page;
    for (const [name, node] of Object.entries(this.tabs) as [GoalsPage, HTMLButtonElement][]) {
      const picked = name === page;
      node.classList.toggle('is-selected', picked);
      node.setAttribute('aria-selected', String(picked));
    }
    this.list.hidden = page !== 'goals';
    this.career.hidden = page !== 'career';
    this.overlay.dataset.page = page;
    this.title.textContent = this.strings.t(page === 'goals' ? 'achievements.title' : 'career.title');
    this.intro.textContent = this.strings.t(page === 'goals' ? 'achievements.intro' : 'career.intro');
    this.list.scrollTop = 0;
    this.career.scrollTop = 0;
  }

  /** The goals as they stand: to collect first, then the closest to done, then those collected. */
  show(goals: readonly AchievementShown[]): void {
    const document = this.overlay.ownerDocument;
    const rank = (goal: AchievementShown): number => (goal.claimed ? 2 : goal.reached ? 0 : 1);
    const ordered = [...goals].sort(
      (a, b) => rank(a) - rank(b) || b.progress / b.target - a.progress / a.target,
    );
    this.list.replaceChildren(...ordered.map((goal) => this.card(document, goal)));
  }

  /** Goal `achievementId` was collected: its card pops and bursts coins, then shows it collected. */
  showClaimed(achievementId: string): void {
    const card = this.list.querySelector<HTMLElement>(`[data-goal="${achievementId}"]`);
    if (card === null) {
      return;
    }
    card.dataset.state = 'claimed';
    card.classList.add('is-claimed');
    const claim = card.querySelector<HTMLElement>('[data-action="claim-goal"]');
    claim?.replaceWith(element(card.ownerDocument, 'span', 'goals__done', this.strings.t('achievements.collected')));
  }

  close(): void {
    this.overlay.hidden = true;
  }

  dispose(): void {
    this.overlay.remove();
  }

  private card(document: Document, goal: AchievementShown): HTMLElement {
    const { strings } = this;
    const card = element(document, 'article', 'goals__card');
    card.dataset.goal = goal.id;
    card.dataset.state = goal.claimed ? 'claimed' : goal.reached ? 'reached' : 'open';
    const text = element(document, 'div', 'goals__text');
    const title = element(document, 'h3', 'goals__name');
    title.append(
      element(document, 'span', '', strings.t(`achievement.metric.${goal.metric}`)),
      element(document, 'span', 'goals__target', strings.number(goal.target)),
    );
    const bar = element(document, 'div', 'meter goals__meter');
    const fill = element(document, 'div', 'meter__fill');
    fill.style.transform = `scaleX(${Math.min(1, goal.progress / goal.target)})`;
    bar.append(fill);
    const line = element(document, 'p', 'goals__line');
    line.append(
      element(document, 'span', 'goals__progress', `${strings.number(goal.progress)} / ${strings.number(goal.target)}`),
      element(document, 'span', 'goals__reward', strings.t('achievements.reward', { amount: goal.reward })),
    );
    text.append(title, bar, line);
    card.append(icon(document, METRIC_ICONS[goal.metric], 'goals__metric-icon'), text);
    if (goal.claimed) {
      card.append(element(document, 'span', 'goals__done', strings.t('achievements.collected')));
    } else if (goal.reached) {
      card.append(
        withIcon(
          button(document, 'button--primary goals__claim', strings.t('achievements.collect', { amount: goal.reward }), 'claim-goal', () =>
            this.actions.onClaim(goal.id),
          ),
          'coins',
        ),
      );
    }
    const burst = element(document, 'span', 'goals__burst');
    burst.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < COINS; index++) {
      const angle = (index / COINS) * Math.PI * 2;
      const coin = element(document, 'span', 'daily__coin');
      coin.style.setProperty('--dx', `${Math.round(Math.cos(angle) * 90)}px`);
      coin.style.setProperty('--dy', `${Math.round(Math.sin(angle) * 50 - 20)}px`);
      coin.style.setProperty('--delay', `${(index % 3) * 40}ms`);
      burst.append(coin);
    }
    card.append(burst);
    return card;
  }
}
