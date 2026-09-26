import type { Clock } from '../../core/time/Clock';
import type { ContentCatalog } from '../../data/ContentCatalog';
import { PLAYER_COMPANY_ID } from '../../data/definitions/RivalCompanyDefinition';
import type { CompanyService } from '../../systems/company/CompanyService';
import type { DrivingService } from '../../systems/driving/DrivingService';
import type { EconomyService } from '../../systems/economy/EconomyService';
import type { EventService } from '../../systems/events/EventService';
import type { FleetService } from '../../systems/fleet/FleetService';
import type { DailyContracts } from '../../systems/missions/DailyContracts';
import type { JobOffer, MissionService } from '../../systems/missions/MissionService';
import type { RivalService } from '../../systems/rivals/RivalService';
import type { DamageService } from '../../systems/vehicles/DamageService';
import type { FuelService } from '../../systems/vehicles/FuelService';
import type { GarageService, OwnedTruck } from '../../systems/vehicles/GarageService';
import type { UpgradeService } from '../../systems/vehicles/UpgradeService';
import { element, setText } from '../dom';
import type { Strings } from '../i18n';
import { icon, type IconName } from '../icons';
import { eventCard } from './eventCards';
import { sortEvents } from './eventText';
import { FleetPage } from './fleetPage';
import { truckCard } from './garageCards';
import { HQ_TABS, type HqTab } from './hqTabs';
import { jobCard, routeText, type JobRivalry } from './jobCards';
import { sortJobOffers } from './jobOrder';
import { paintPicker } from './paintPicker';
import { cssColor, RivalsPage } from './rivalsPage';
import { truckPage } from './truckPage';
import { upgradeCard } from './upgradeCards';

/** What the panel shows. It only reads them; changes go through the actions. */
export interface CompanyHqServices {
  readonly content: ContentCatalog;
  readonly driving: DrivingService;
  readonly missions: MissionService;
  readonly economy: EconomyService;
  readonly company: CompanyService;
  readonly fuel: FuelService;
  readonly damage: DamageService;
  readonly garage: GarageService;
  readonly upgrades: UpgradeService;
  readonly specialEvents: EventService;
  readonly dailyContracts: DailyContracts;
  readonly fleet: FleetService;
  readonly rivals: RivalService;
  readonly clock: Clock;
}

/** Something shown on the truck in the showroom before it is bought: a paint, an upgrade's next level, another model. */
export type TruckPreview =
  | { readonly kind: 'paint'; readonly paintId: string | null }
  | { readonly kind: 'upgrade'; readonly upgradeId: string }
  | { readonly kind: 'truck'; readonly definitionId: string };

export interface CompanyHqActions {
  readonly onAccept: (missionId: string) => void;
  readonly onRefuel: () => void;
  readonly onRepair: () => void;
  readonly onBuyTruck: (definitionId: string) => void;
  readonly onSwitchTruck: (instanceId: string) => void;
  readonly onPaintTruck: (instanceId: string, paintId: string | null) => void;
  readonly onBuyUpgrade: (upgradeId: string) => void;
  readonly onHireDriver: (driverId: string) => void;
  readonly onDismissDriver: (driverId: string) => void;
  /** Sends a truck in the garage out on contracts with a hired driver. */
  readonly onAssignDriver: (driverId: string, instanceId: string) => void;
  /** Calls a driver's truck back to the garage. */
  readonly onRecallTruck: (driverId: string) => void;
  /** Runs a campaign in a city. */
  readonly onCampaign: (cityId: string) => void;
  /** Buys a rival company out. */
  readonly onBuyOut: (rivalId: string) => void;
  /** Shows `preview` on the truck while the panel is open; null shows the truck as it is. */
  readonly onPreview: (preview: TruckPreview | null) => void;
  readonly onOpenMap: () => void;
  readonly onClose: () => void;
}

const TAB_ICONS: Readonly<Record<HqTab, IconName>> = {
  jobs: 'jobs',
  truck: 'truck',
  garage: 'garage',
  fleet: 'fleet',
  rivals: 'rivals',
  events: 'events',
};

/**
 * The company HQ (spec §26), as a panel over the game: the world and the
 * truck stay in sight beside it (on a phone held upright, above it), and
 * the garage shows the truck in its showroom light. At the top: the
 * company's name, level, XP, reputation and credits, the map and the way
 * back to the road. Four pages: the job board (spec §28), where each blocked
 * contract says what unlocks it and each one an event rewards says so; the
 * truck being driven, with its fuel, damage, cargo and parts, refuelling and
 * repairs; the garage (spec §15, §16): paint and upgrades for the truck,
 * each shown on it before it is bought, and the trucks to buy or switch to;
 * and the special events (spec §22) with their progress. Everything below
 * the tabs scrolls as one list.
 */
export class CompanyHq {
  private readonly root: HTMLDivElement;
  private readonly sheet: HTMLElement;
  private readonly companyName: HTMLHeadingElement;
  private readonly levelLabel: HTMLSpanElement;
  private readonly xpFill: HTMLDivElement;
  private readonly xpLabel: HTMLSpanElement;
  private readonly reputation: HTMLSpanElement;
  private readonly credits: HTMLSpanElement;
  private readonly tabs: ReadonlyMap<HqTab, HTMLButtonElement>;
  private readonly list: HTMLDivElement;
  /** Where the tutorial's hint goes while the panel is open: above the list, in the flow. */
  readonly hintSlot: HTMLDivElement;
  private tab: HqTab = 'jobs';
  private preview: TruckPreview | null = null;
  private readonly fleetPage: FleetPage;
  private readonly rivalsPage: RivalsPage;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    private readonly services: CompanyHqServices,
    private readonly actions: CompanyHqActions,
  ) {
    const document = parent.ownerDocument;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) =>
      element(document, tag, className, text);
    this.root = el('div', 'hq');
    this.root.dataset.screen = 'companyHq';
    this.root.hidden = true;
    this.sheet = el('section', 'hq__sheet');
    this.sheet.setAttribute('role', 'dialog');
    this.sheet.setAttribute('aria-label', strings.t('hq.title'));

    // The company, its money, the map and the way back to the road.
    const header = el('header', 'hq__header');
    const company = el('div', 'hq__company');
    this.companyName = el('h2', 'hq__company-name');
    this.levelLabel = el('span', 'hq__level');
    const xpBar = el('div', 'meter meter--xp');
    this.xpFill = el('div', 'meter__fill');
    xpBar.append(this.xpFill);
    this.xpLabel = el('span', 'hq__xp');
    this.reputation = el('span', 'hq__reputation');
    const progress = el('div', 'hq__progress');
    progress.append(this.levelLabel, xpBar, this.xpLabel, this.reputation);
    company.append(this.companyName, progress);
    const money = el('span', 'hq__money');
    this.credits = el('span', 'hq__credits');
    this.credits.dataset.value = 'credits';
    money.append(icon(document, 'coins'), this.credits);
    const iconButton = (name: IconName, label: string, action: string, onClick: () => void): HTMLButtonElement => {
      const node = el('button', 'hq__icon-button');
      node.type = 'button';
      node.dataset.action = action;
      node.setAttribute('aria-label', label);
      node.title = label;
      node.append(icon(document, name));
      node.addEventListener('click', onClick);
      return node;
    };
    header.append(
      company,
      money,
      iconButton('map', strings.t('hq.map'), 'hq-map', actions.onOpenMap),
      iconButton('close', strings.t('hq.close'), 'close-hq', actions.onClose),
    );

    const tabBar = el('nav', 'hq__tabs');
    tabBar.setAttribute('role', 'tablist');
    const tabs = new Map<HqTab, HTMLButtonElement>();
    for (const tab of HQ_TABS) {
      const tabButton = el('button', 'hq__tab');
      tabButton.type = 'button';
      tabButton.dataset.action = 'tab';
      tabButton.dataset.tab = tab;
      tabButton.setAttribute('role', 'tab');
      tabButton.append(icon(document, TAB_ICONS[tab]), el('span', 'hq__tab-label', strings.t(`hq.tab.${tab}`)));
      tabButton.addEventListener('click', () => this.selectTab(tab));
      tabs.set(tab, tabButton);
      tabBar.append(tabButton);
    }
    this.tabs = tabs;
    this.hintSlot = el('div', 'hq__hint');
    // The one scrolling part: a finger dragged anywhere on it scrolls it, never the page behind.
    this.list = el('div', 'hq__list');
    this.list.setAttribute('role', 'tabpanel');
    this.sheet.append(header, tabBar, this.hintSlot, this.list);
    this.root.append(this.sheet);
    parent.append(this.root);
    this.fleetPage = new FleetPage(document, strings, services, {
      onHire: actions.onHireDriver,
      onDismiss: actions.onDismissDriver,
      onAssign: actions.onAssignDriver,
      onRecall: actions.onRecallTruck,
      onSwitch: actions.onSwitchTruck,
    });
    this.rivalsPage = new RivalsPage(
      document,
      strings,
      { rivals: services.rivals, economy: services.economy, company: services.company, now: () => services.clock.now() },
      { onCampaign: actions.onCampaign, onBuyOut: actions.onBuyOut },
    );
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** The page on show. */
  get currentTab(): HqTab {
    return this.tab;
  }

  /** Opens the panel on `tab`, with fresh figures. */
  open(tab: HqTab): void {
    this.root.hidden = false;
    this.selectTab(tab);
  }

  /** Closes the panel: the truck is shown as it is again. */
  close(): void {
    this.showPreview(null);
    this.root.hidden = true;
  }

  /** Shows `tab`, from the top. */
  selectTab(tab: HqTab): void {
    this.tab = tab;
    this.refresh();
    this.list.scrollTop = 0;
  }

  /**
   * Redraws the figures and the open page (after a purchase, a level-up, a
   * delivery), keeping the list where it was scrolled to. Anything previewed
   * goes: what was bought is on the truck now. Not per frame.
   */
  refresh(): void {
    const { company, economy } = this.services;
    const strings = this.strings;

    setText(this.companyName, company.companyName);
    const progress = company.levelProgress;
    setText(
      this.levelLabel,
      `${strings.t('company.level', { level: progress.level })} · ${strings.t(`company.levelName.${progress.level}`)}`,
    );
    this.xpFill.style.transform = `scaleX(${progress.fraction})`;
    setText(
      this.xpLabel,
      progress.xpForLevel === null
        ? strings.t('company.topLevel')
        : strings.t('company.xp', { xp: strings.number(progress.xpIntoLevel), next: strings.number(progress.xpForLevel) }),
    );
    setText(this.credits, strings.money(economy.credits));
    setText(this.reputation, `${strings.t('company.reputation')} ${company.reputation}`);

    for (const [tab, tabButton] of this.tabs) {
      tabButton.classList.toggle('is-selected', tab === this.tab);
      tabButton.setAttribute('aria-selected', String(tab === this.tab));
    }
    this.root.dataset.tab = this.tab;
    this.list.dataset.tab = this.tab;
    this.showPreview(null);
    const scrolled = this.list.scrollTop;
    this.list.replaceChildren(...this.tabContent());
    this.list.scrollTop = scrolled;
  }

  /**
   * Moves the fleet page's progress bars and the rivals page's campaign
   * waits on while they show, and draws them again when a driver moves on
   * to another contract or something happens in the market: call a few
   * times a second, not every frame.
   */
  tick(): void {
    if (!this.isOpen) {
      return;
    }
    if ((this.tab === 'fleet' && this.fleetPage.tick()) || (this.tab === 'rivals' && this.rivalsPage.tick())) {
      this.refresh();
    }
  }

  /**
   * The share of the screen the panel covers: its width at the right (a
   * phone on its side) or its height at the bottom (upright). The showroom
   * frames the truck in the rest. Reads the layout: call on opening and
   * resizing, not per frame.
   */
  coveredShare(): { readonly right: number; readonly bottom: number } {
    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    if (this.root.hidden || width === 0 || height === 0) {
      return { right: 0, bottom: 0 };
    }
    // The layout box, not the one on screen: the panel may still be sliding in.
    const sheet = this.sheet;
    // Upright, the sheet spans the width and rises from the bottom; on its side it stands at the right.
    return sheet.offsetWidth >= width * 0.9
      ? { right: 0, bottom: Math.min(1, (height - sheet.offsetTop) / height) }
      : { right: Math.min(1, (width - sheet.offsetLeft) / width), bottom: 0 };
  }

  dispose(): void {
    this.root.remove();
  }

  /** Shows `preview` on the truck (or the truck as it is), and marks the card that shows it. */
  private showPreview(preview: TruckPreview | null): void {
    if (previewKey(preview) === previewKey(this.preview)) {
      return;
    }
    this.preview = preview;
    const key = previewKey(preview);
    for (const card of this.list.querySelectorAll<HTMLElement>('[data-preview-key]')) {
      const shown = card.dataset.previewKey === key;
      card.classList.toggle('is-previewing', shown);
      card.querySelector('.hq__preview')?.setAttribute('aria-pressed', String(shown));
    }
    this.actions.onPreview(preview);
  }

  /** A second tap on what is shown puts the truck back as it is. */
  private togglePreview(preview: TruckPreview): void {
    this.showPreview(previewKey(preview) === previewKey(this.preview) ? null : preview);
  }

  private tabContent(): HTMLElement[] {
    switch (this.tab) {
      case 'jobs':
        return this.jobsPage();
      case 'truck':
        return truckPage(this.root.ownerDocument, this.strings, this.services, {
          onRefuel: this.actions.onRefuel,
          onRepair: this.actions.onRepair,
        });
      case 'garage':
        return this.garagePage();
      case 'fleet':
        return this.fleetPage.render();
      case 'rivals':
        return this.rivalsPage.render();
      case 'events':
        return [
          element(this.root.ownerDocument, 'p', 'hq__note', this.strings.t('hq.events.note')),
          ...sortEvents(this.services.specialEvents.statuses()).map((status) =>
            eventCard(this.root.ownerDocument, this.strings, status),
          ),
        ];
    }
  }

  private jobsPage(): HTMLElement[] {
    const document = this.root.ownerDocument;
    const { strings, actions } = this;
    const { missions, specialEvents, dailyContracts, rivals } = this.services;
    // A tender is shown first among those like it: it is gone when the next comes.
    const offers = sortJobOffers(missions.jobBoard(), (offer) => rivals.tenderFor(offer.mission.id) !== null);
    const busy = missions.active !== null;
    // The tutorial points at the first of the game's own contracts the company can take: it starts at home.
    const firstOwn = offers.find((offer) => !offer.daily && offer.blockedBy === null);
    const cards = offers.map((offer) => {
      const card = jobCard(
        document,
        strings,
        offer,
        actions.onAccept,
        offer.blockedBy === null ? specialEvents.eventsForContract(offer.mission) : [],
        busy,
        this.rivalry(offer),
      );
      card.classList.toggle('job-card--tutorial', offer === firstOwn && !busy);
      return card;
    });
    const page: HTMLElement[] = [];
    const current = missions.activeDefinition;
    if (current !== null) {
      const note = element(document, 'p', 'hq__note hq__current-job');
      note.append(
        icon(document, 'route'),
        element(document, 'span', '', strings.t('hq.jobs.current', { title: strings.missionTitle(current), route: routeText(strings, current) })),
      );
      page.push(note);
    }
    if (cards.length === 0) {
      return [...page, element(document, 'p', 'hq__empty', strings.t('hq.noJobs'))];
    }
    if (offers.some((offer) => offer.daily)) {
      const note = strings.t('hq.dailyNote', {
        hours: dailyContracts.refreshHours,
        time: strings.timeSpan(dailyContracts.msUntilNextBatch()),
      });
      page.push(element(document, 'p', 'hq__note', note));
    }
    return [...page, ...cards];
  }

  /** What the rivals mean for a contract: a tender's race and prize, the bonus of a city the company leads. */
  private rivalry(offer: JobOffer): JobRivalry {
    const { rivals } = this.services;
    const tender = rivals.tenderFor(offer.mission.id);
    const color = tender === null ? null : rivals.colorOf(tender.rivalId);
    return {
      tender:
        tender === null
          ? null
          : { rival: this.strings.rivalName(tender.rivalId), color: color === null ? '' : cssColor(color), prize: tender.prize },
      leaderBonus: rivals.leaderOf(offer.mission.originCityId) === PLAYER_COMPANY_ID ? rivals.terms.leaderBonus : null,
    };
  }

  /** Paint and upgrades for the truck being driven, each shown on it before it is bought, then the trucks. */
  private garagePage(): HTMLElement[] {
    const document = this.root.ownerDocument;
    const { strings, actions } = this;
    const { economy, garage, upgrades, missions } = this.services;
    const canAfford = (price: number): boolean => economy.canAfford(price);
    const truck = garage.activeTruck;
    const section = (name: string, title: string, ...content: HTMLElement[]): HTMLElement => {
      const node = element(document, 'section', `hq__section hq__section--${name}`);
      node.append(element(document, 'h3', 'hq__section-title', title), ...content);
      return node;
    };

    const paint = section(
      'paint',
      strings.t('hq.garage.paint'),
      paintPicker(
        document,
        strings,
        { truck, offers: garage.paintShop(), canAfford },
        actions.onPaintTruck,
        (paintId) => this.showPreview({ kind: 'paint', paintId }),
      ),
    );

    const upgradeCards = element(document, 'div', 'hq__cards');
    upgradeCards.append(
      ...upgrades.offers().map((offer) =>
        upgradeCard(
          document,
          strings,
          offer,
          offer.next !== null && economy.canAfford(offer.next.cost),
          actions.onBuyUpgrade,
          {
            previewing: false,
            onPreview: (upgradeId) => this.togglePreview({ kind: 'upgrade', upgradeId }),
          },
        ),
      ),
    );
    const upgradesSection = section(
      'upgrades',
      strings.t('hq.garage.upgrades'),
      element(document, 'p', 'hq__note', strings.t('hq.upgrades.for', { truck: strings.vehicleName(truck.definition.id) })),
      upgradeCards,
    );

    const owned = garage.trucks;
    const busy = missions.active !== null;
    const truckCards = element(document, 'div', 'hq__cards');
    truckCards.append(
      ...garage.dealer().map((offer) =>
        truckCard(
          document,
          strings,
          {
            offer,
            owned: ownedToShow(owned.filter((candidate) => candidate.definition.id === offer.definition.id)),
            busy,
            canAfford,
            previewing: false,
            garage: { count: owned.length, capacity: garage.capacity },
          },
          {
            onBuy: actions.onBuyTruck,
            onSwitch: actions.onSwitchTruck,
            onPreview: (definitionId) => this.togglePreview({ kind: 'truck', definitionId }),
          },
        ),
      ),
    );
    const trucksSection = section('trucks', strings.t('hq.garage.trucks'), truckCards);
    return [paint, upgradesSection, trucksSection];
  }
}

/** Of the company's trucks of one model, the one its garage card shows: the one driven, else one in the garage, else one out. */
function ownedToShow(trucks: readonly OwnedTruck[]): OwnedTruck | undefined {
  return trucks.find((truck) => truck.active) ?? trucks.find((truck) => truck.driverId === null) ?? trucks[0];
}

/** Which card a preview belongs to (`data-preview-key`); a paint has no card, its swatch shows it. */
function previewKey(preview: TruckPreview | null): string {
  if (preview === null) {
    return '';
  }
  switch (preview.kind) {
    case 'paint':
      return `paint:${preview.paintId ?? 'factory'}`;
    case 'upgrade':
      return `upgrade:${preview.upgradeId}`;
    case 'truck':
      return `truck:${preview.definitionId}`;
  }
}
