import { PLAYER_COMPANY_ID } from '../../data/definitions/RivalCompanyDefinition';
import type { CompanyService } from '../../systems/company/CompanyService';
import type { EconomyService } from '../../systems/economy/EconomyService';
import type { CityStatus, LeagueEntry, MarketNews, RivalService, RivalStatus } from '../../systems/rivals/RivalService';
import { button, element, setText } from '../dom';
import type { Strings } from '../i18n';

/** The player's company on the map and in the bars: the fleet's amber. */
export const PLAYER_COLOR = '#ffb020';

/** What the rivals page reads. It only reads them; changes go through the actions. */
export interface RivalsPageServices {
  readonly rivals: RivalService;
  readonly economy: EconomyService;
  readonly company: CompanyService;
  /** Now, epoch ms (the game's Clock): how long ago the news happened. */
  readonly now: () => number;
}

export interface RivalsPageActions {
  readonly onCampaign: (cityId: string) => void;
  readonly onBuyOut: (rivalId: string) => void;
}

/** A campaign's wait on the page, counted down while it shows (RivalsPage.tick). */
interface LiveWait {
  readonly cityId: string;
  readonly label: HTMLElement;
}

/** `color` (0xRRGGBB) as CSS. */
export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/**
 * The rival companies (spec §65 V3), a page of the company panel: the
 * league by what each company is worth; each city with everyone's share of
 * it, its leader, and the company's campaign there; each rival, where it is
 * at home, its trucks and money, and the price of buying it out once the
 * company is worth more; and the news of the market.
 */
export class RivalsPage {
  private readonly waits: LiveWait[] = [];
  /** The news shown: when it changes, the page is drawn again. */
  private shownNews: MarketNews | undefined;

  constructor(
    private readonly document: Document,
    private readonly strings: Strings,
    private readonly services: RivalsPageServices,
    private readonly actions: RivalsPageActions,
  ) {}

  /** The page's content, afresh. */
  render(): HTMLElement[] {
    const { document, strings } = this;
    const { rivals } = this.services;
    const terms = rivals.terms;
    this.waits.length = 0;
    this.shownNews = rivals.news[0];

    const league = element(document, 'ol', 'league');
    league.append(...rivals.league().map((entry, index) => this.leagueRow(entry, index + 1)));
    const cities = element(document, 'div', 'hq__cards');
    cities.append(...rivals.cities().map((city) => this.cityCard(city)));
    const companies = element(document, 'div', 'hq__cards');
    companies.append(...rivals.statuses().map((status) => this.rivalCard(status)));

    return [
      element(
        document,
        'p',
        'hq__note',
        strings.t('hq.rivals.note', { share: strings.percent(terms.leadShare), bonus: strings.percent(terms.leaderBonus) }),
      ),
      this.section('league', strings.t('hq.rivals.league'), strings.t('hq.rivals.leagueNote'), league),
      this.section('cities', strings.t('hq.rivals.cities'), strings.t('hq.rivals.citiesNote'), cities),
      this.section('companies', strings.t('hq.rivals.companies'), null, companies),
      this.section('news', strings.t('hq.rivals.news'), null, this.newsList()),
    ];
  }

  /**
   * Counts the campaigns' waits down without rebuilding the page. True when
   * the page needs drawing again: a wait is over, or something happened in
   * the market. Cheap; call a few times a second.
   */
  tick(): boolean {
    const { rivals } = this.services;
    if (rivals.news[0] !== this.shownNews) {
      return true;
    }
    if (this.waits.length === 0) {
      return false;
    }
    const cities = rivals.cities();
    for (const wait of this.waits) {
      const seconds = cities.find((city) => city.cityId === wait.cityId)?.campaignSecondsLeft ?? 0;
      if (seconds <= 0) {
        return true;
      }
      setText(wait.label, this.strings.t('hq.rivals.campaignWait', { time: this.strings.duration(seconds) }));
    }
    return false;
  }

  private section(name: string, title: string, note: string | null, content: HTMLElement): HTMLElement {
    const node = element(this.document, 'section', `hq__section hq__section--${name}`);
    node.append(element(this.document, 'h3', 'hq__section-title', title));
    if (note !== null) {
      node.append(element(this.document, 'p', 'hq__note', note));
    }
    node.append(content);
    return node;
  }

  private leagueRow(entry: LeagueEntry, rank: number): HTMLElement {
    const { document, strings } = this;
    const row = element(document, 'li', 'league__row');
    row.dataset.companyId = entry.companyId;
    row.classList.toggle('is-player', entry.companyId === PLAYER_COMPANY_ID);
    const details = element(
      document,
      'span',
      'league__details',
      `${strings.t('hq.rivals.trucks', { count: entry.trucks })} · ${strings.t('hq.rivals.citiesLed', { count: entry.cities })}`,
    );
    const name = element(document, 'span', 'league__name');
    name.append(this.swatch(entry.companyId), element(document, 'span', '', this.companyName(entry.companyId, true)));
    const who = element(document, 'div', 'league__who');
    who.append(name, details);
    row.append(element(document, 'span', 'league__rank', String(rank)), who, element(document, 'span', 'league__value', strings.money(entry.value)));
    return row;
  }

  private cityCard(city: CityStatus): HTMLElement {
    const { document, strings, actions } = this;
    const { rivals, economy } = this.services;
    const terms = rivals.terms;
    const card = element(document, 'article', 'city-card');
    card.dataset.cityId = city.cityId;
    card.dataset.leader = city.leaderId ?? '';
    card.classList.toggle('is-yours', city.leaderId === PLAYER_COMPANY_ID);

    const top = element(document, 'div', 'city-card__top');
    top.append(
      element(document, 'h3', 'city-card__title', strings.cityName(city.cityId)),
      element(
        document,
        'span',
        'city-card__leader',
        city.leaderId === null
          ? strings.t('hq.rivals.contested')
          : strings.t('hq.rivals.leader', { company: this.companyName(city.leaderId, false) }),
      ),
    );
    const bar = element(document, 'div', 'share-bar');
    bar.setAttribute('role', 'img');
    const described: string[] = [];
    for (const { companyId, share } of city.shares) {
      if (share <= 0) {
        continue;
      }
      const part = element(document, 'span', 'share-bar__part');
      part.dataset.companyId = companyId;
      part.style.width = `${(share * 100).toFixed(2)}%`;
      part.style.setProperty('--company-color', this.color(companyId));
      bar.append(part);
      described.push(`${this.companyName(companyId, false)} ${strings.percent(share)}`);
    }
    bar.setAttribute('aria-label', described.join(', '));
    const own = city.shares.find((share) => share.companyId === PLAYER_COMPANY_ID)?.share ?? 0;
    const standing = element(
      document,
      'p',
      'city-card__share',
      city.leaderId === PLAYER_COMPANY_ID
        ? strings.t('hq.rivals.youLead', { bonus: strings.percent(terms.leaderBonus) })
        : strings.t('hq.rivals.yourShare', { percent: strings.percent(own) }),
    );
    standing.dataset.value = 'share';
    const bottom = element(document, 'div', 'city-card__bottom');
    if (city.campaignSecondsLeft > 0) {
      const wait = element(
        document,
        'span',
        'city-card__wait',
        strings.t('hq.rivals.campaignWait', { time: strings.duration(city.campaignSecondsLeft) }),
      );
      this.waits.push({ cityId: city.cityId, label: wait });
      bottom.append(wait);
    } else {
      const campaign = button(
        document,
        'button--secondary city-card__action',
        strings.t('hq.rivals.campaign', { price: strings.money(terms.campaignCost) }),
        'run-campaign',
        () => actions.onCampaign(city.cityId),
      );
      campaign.disabled = !economy.canAfford(terms.campaignCost);
      bottom.append(campaign);
    }
    card.append(top, bar, standing, bottom);
    return card;
  }

  private rivalCard(status: RivalStatus): HTMLElement {
    const { document, strings, actions } = this;
    const { definition } = status;
    const card = element(document, 'article', 'rival-card');
    card.dataset.rivalId = definition.id;
    card.classList.toggle('is-acquired', status.acquired);
    card.style.setProperty('--company-color', cssColor(definition.color));

    const top = element(document, 'div', 'rival-card__top');
    const name = element(document, 'h3', 'rival-card__title');
    name.append(this.swatch(definition.id), element(document, 'span', '', strings.rivalName(definition.id)));
    top.append(name, element(document, 'span', 'rival-card__home', strings.t('hq.rivals.home', { city: strings.cityName(definition.homeCityId) })));
    const bottom = element(document, 'div', 'rival-card__bottom');
    if (status.acquired) {
      card.append(top);
      bottom.append(element(document, 'span', 'rival-card__status', strings.t('hq.rivals.acquired')));
      card.append(bottom);
      return card;
    }
    const facts = element(document, 'dl', 'rival-card__facts');
    for (const [label, value] of [
      [strings.t('hq.rivals.worth'), strings.money(status.value)],
      [strings.t('hq.rivals.fleet'), strings.number(status.trucks)],
      [strings.t('hq.rivals.inHand'), strings.money(status.credits)],
    ] as const) {
      const fact = element(document, 'div', 'rival-card__fact');
      fact.append(element(document, 'dt', '', label), element(document, 'dd', '', value));
      facts.append(fact);
    }
    if (status.withinReach) {
      const buy = button(
        document,
        'button--primary rival-card__action',
        strings.t('hq.rivals.buyOut', { price: strings.money(status.price) }),
        'buy-out-rival',
        () => actions.onBuyOut(definition.id),
      );
      buy.disabled = !this.services.economy.canAfford(status.price);
      bottom.append(buy);
    } else {
      bottom.append(element(document, 'span', 'rival-card__status', strings.t('hq.rivals.tooStrong')));
    }
    card.append(top, facts, bottom);
    return card;
  }

  private newsList(): HTMLElement {
    const { document, strings } = this;
    const news = this.services.rivals.news;
    if (news.length === 0) {
      return element(document, 'p', 'hq__empty rival-news__empty', strings.t('hq.rivals.noNews'));
    }
    const now = this.services.now();
    const list = element(document, 'ul', 'rival-news');
    for (const item of news) {
      const entry = element(document, 'li', 'rival-news__item');
      entry.dataset.kind = item.kind;
      entry.append(
        this.swatch(item.companyId ?? ''),
        element(document, 'span', 'rival-news__text', this.newsText(item)),
        element(document, 'span', 'rival-news__time', strings.t('hq.rivals.ago', { time: strings.timeSpan(now - item.atMs) })),
      );
      list.append(entry);
    }
    return list;
  }

  private newsText(item: MarketNews): string {
    const { strings } = this;
    switch (item.kind) {
      case 'leader':
        return item.companyId === null
          ? strings.t('hq.rivals.newsContested', { city: strings.cityName(item.cityId) })
          : strings.t('hq.rivals.newsLeader', { city: strings.cityName(item.cityId), company: this.companyName(item.companyId, false) });
      case 'campaign':
        return item.companyId === PLAYER_COMPANY_ID
          ? strings.t('hq.rivals.newsYourCampaign', { city: strings.cityName(item.cityId) })
          : strings.t('hq.rivals.newsCampaign', { city: strings.cityName(item.cityId), company: strings.rivalName(item.companyId) });
      case 'truck':
        return strings.t('hq.rivals.newsTruck', { company: strings.rivalName(item.companyId), count: item.trucks });
      case 'tender':
        return strings.t(item.won ? 'hq.rivals.newsTenderWon' : 'hq.rivals.newsTenderLost', { company: strings.rivalName(item.companyId) });
      case 'acquired':
        return strings.t('hq.rivals.newsAcquired', { company: strings.rivalName(item.companyId) });
    }
  }

  /** A company's name: the player's own ("… (you)" in the league), or a rival's. */
  private companyName(companyId: string, you: boolean): string {
    if (companyId !== PLAYER_COMPANY_ID) {
      return this.strings.rivalName(companyId);
    }
    const name = this.services.company.companyName;
    return you ? this.strings.t('hq.rivals.you', { name }) : name;
  }

  private color(companyId: string): string {
    const color = this.services.rivals.colorOf(companyId);
    return color === null ? PLAYER_COLOR : cssColor(color);
  }

  /** A dot in the company's colour; none for nobody. */
  private swatch(companyId: string): HTMLElement {
    const dot = element(this.document, 'span', 'company-swatch');
    dot.setAttribute('aria-hidden', 'true');
    if (companyId !== '') {
      dot.style.setProperty('--company-color', this.color(companyId));
    }
    return dot;
  }
}
