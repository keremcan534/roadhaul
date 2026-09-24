import type { ServicePoint } from '../../domain/world/DrivingWorld';
import type { CompanyService } from '../../systems/company/CompanyService';
import type { DrivingService } from '../../systems/driving/DrivingService';
import type { EconomyService } from '../../systems/economy/EconomyService';
import type { EventService } from '../../systems/events/EventService';
import type { MissionService } from '../../systems/missions/MissionService';
import type { DamageService } from '../../systems/vehicles/DamageService';
import type { FuelService } from '../../systems/vehicles/FuelService';
import type { GarageService } from '../../systems/vehicles/GarageService';
import type { UpgradeService } from '../../systems/vehicles/UpgradeService';
import { button, element, setText } from '../dom';
import type { Strings } from '../i18n';
import { eventCard } from './eventCards';
import { sortEvents } from './eventText';
import { truckCard } from './garageCards';
import { HQ_TABS, type HqTab } from './hqTabs';
import { jobCard } from './jobCards';
import { sortJobOffers } from './jobOrder';
import { upgradeCard } from './upgradeCards';

/** What the HQ shows. It only reads them; changes go through the actions. */
export interface CompanyHqServices {
  readonly driving: DrivingService;
  readonly missions: MissionService;
  readonly economy: EconomyService;
  readonly company: CompanyService;
  readonly fuel: FuelService;
  readonly damage: DamageService;
  readonly garage: GarageService;
  readonly upgrades: UpgradeService;
  readonly specialEvents: EventService;
}

export interface CompanyHqActions {
  readonly onAccept: (missionId: string) => void;
  readonly onRefuel: () => void;
  readonly onRepair: () => void;
  readonly onBuyTruck: (definitionId: string) => void;
  readonly onSwitchTruck: (instanceId: string) => void;
  readonly onBuyUpgrade: (upgradeId: string) => void;
  readonly onFreeDrive: () => void;
  readonly onMainMenu: () => void;
  readonly onOpenMap: () => void;
}

/**
 * The company HQ (spec §26): the company's name, level, XP, reputation and
 * credits; the truck being driven, with its fuel and damage, refuelling and
 * repairs; and four tabs: the job board (spec §28), where each blocked
 * contract says what unlocks it and each one an event rewards says so; the
 * special events (spec §22) with their progress; the garage (spec §15), to
 * buy and switch trucks; and the upgrade shop for the truck being driven
 * (spec §16).
 */
export class CompanyHq {
  private readonly root: HTMLDivElement;
  private readonly companyName: HTMLHeadingElement;
  private readonly levelLabel: HTMLParagraphElement;
  private readonly xpFill: HTMLDivElement;
  private readonly xpLabel: HTMLSpanElement;
  private readonly reputation: HTMLSpanElement;
  private readonly credits: HTMLSpanElement;
  private readonly fuelFill: HTMLDivElement;
  private readonly fuelLabel: HTMLSpanElement;
  private readonly damageFill: HTMLDivElement;
  private readonly damageLabel: HTMLSpanElement;
  private readonly refuelButton: HTMLButtonElement;
  private readonly repairButton: HTMLButtonElement;
  private readonly truckName: HTMLParagraphElement;
  private readonly truckLocation: HTMLParagraphElement;
  private readonly serviceNote: HTMLParagraphElement;
  private readonly tabs: ReadonlyMap<HqTab, HTMLButtonElement>;
  private readonly list: HTMLDivElement;
  /** Where the tutorial's hint goes while the HQ is open: above the list, in the flow. */
  readonly hintSlot: HTMLDivElement;
  private tab: HqTab = 'jobs';

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    private readonly services: CompanyHqServices,
    private readonly actions: CompanyHqActions,
  ) {
    const document = parent.ownerDocument;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) =>
      element(document, tag, className, text);
    this.root = el('div', 'screen hq');
    this.root.dataset.screen = 'companyHq';
    this.root.hidden = true;

    // Side column: the company, the truck, and the way out.
    const side = el('aside', 'hq__side');
    const company = el('section', 'hq__card hq__company');
    this.companyName = el('h2', 'hq__company-name');
    this.levelLabel = el('p', 'hq__level');
    const xpBar = el('div', 'meter meter--xp');
    this.xpFill = el('div', 'meter__fill');
    xpBar.append(this.xpFill);
    this.xpLabel = el('span', 'hq__xp');
    const figures = el('div', 'hq__figures');
    this.credits = el('span', 'hq__credits');
    this.credits.dataset.value = 'credits';
    this.reputation = el('span', 'hq__reputation');
    figures.append(this.credits, this.reputation);
    company.append(this.companyName, this.levelLabel, xpBar, this.xpLabel, figures);

    const truck = el('section', 'hq__card hq__truck');
    const gauge = (label: string, className: string): [HTMLDivElement, HTMLSpanElement, HTMLDivElement] => {
      const row = el('div', 'hq__gauge');
      const title = el('span', 'hq__gauge-title', label);
      const value = el('span', 'hq__gauge-value');
      const meter = el('div', `meter ${className}`);
      const fill = el('div', 'meter__fill');
      meter.append(fill);
      row.append(title, value, meter);
      return [row, value, fill];
    };
    const [fuelRow, fuelLabel, fuelFill] = gauge(strings.t('hq.fuel'), 'meter--fuel');
    const [damageRow, damageLabel, damageFill] = gauge(strings.t('hq.damage'), 'meter--damage');
    this.fuelLabel = fuelLabel;
    this.fuelFill = fuelFill;
    this.damageLabel = damageLabel;
    this.damageFill = damageFill;
    this.refuelButton = button(document, 'button--secondary hq__service', '', 'refuel', actions.onRefuel);
    this.repairButton = button(document, 'button--secondary hq__service', '', 'repair', actions.onRepair);
    this.truckName = el('p', 'hq__truck-name');
    this.truckLocation = el('p', 'hq__truck-location');
    this.serviceNote = el('p', 'hq__service-note', strings.t('hq.serviceAway'));
    truck.append(
      el('h3', 'hq__card-title', strings.t('hq.truck')),
      this.truckName,
      this.truckLocation,
      fuelRow,
      this.refuelButton,
      damageRow,
      this.repairButton,
      this.serviceNote,
    );

    side.append(company, truck);

    // The board's header row keeps the way out in sight however long the columns get.
    const board = el('section', 'hq__board');
    const header = el('div', 'hq__board-header');
    const tools = el('div', 'hq__tools');
    tools.append(
      button(document, 'button--ghost', strings.t('hq.mainMenu'), 'main-menu', actions.onMainMenu),
      button(document, 'button--ghost', strings.t('hq.map'), 'hq-map', actions.onOpenMap),
      button(document, 'button--secondary', strings.t('hq.freeDrive'), 'free-drive', actions.onFreeDrive),
    );
    const tabBar = el('div', 'hq__tabs');
    tabBar.setAttribute('role', 'tablist');
    const tabs = new Map<HqTab, HTMLButtonElement>();
    for (const tab of HQ_TABS) {
      const tabButton = button(document, 'hq__tab', strings.t(`hq.tab.${tab}`), 'tab', () => this.selectTab(tab));
      tabButton.dataset.tab = tab;
      tabButton.setAttribute('role', 'tab');
      tabs.set(tab, tabButton);
      tabBar.append(tabButton);
    }
    this.tabs = tabs;
    header.append(tabBar, tools);
    this.list = el('div', 'hq__list');
    this.list.setAttribute('role', 'tabpanel');
    this.hintSlot = el('div', 'hq__hint');
    board.append(header, this.hintSlot, this.list);
    this.root.append(side, board);
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Opens the HQ on the job board, with fresh figures. */
  show(): void {
    this.selectTab('jobs');
    this.root.hidden = false;
  }

  /** Shows `tab`, from the top. */
  selectTab(tab: HqTab): void {
    this.tab = tab;
    this.refresh();
    this.list.scrollTop = 0;
  }

  /** Redraws the figures and the open tab (after a purchase, a level-up, a delivery). Not per frame. */
  refresh(): void {
    const { company, economy, fuel, damage, garage } = this.services;
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

    const active = garage.activeTruck.definition;
    setText(this.truckName, `${strings.vehicleName(active.id)} · ${strings.t(`body.${active.bodyType}`)}`);
    const servicePoint = this.services.driving.servicePoint;
    setText(this.truckLocation, locationText(strings, servicePoint));
    this.serviceNote.hidden = servicePoint !== null;
    setText(this.fuelLabel, `${strings.percent(fuel.fraction)} · ${strings.t('format.liters', { value: Math.round(fuel.fuelLiters) })}`);
    this.fuelFill.style.transform = `scaleX(${fuel.fraction})`;
    this.fuelFill.parentElement!.classList.toggle('is-low', fuel.isLow);
    const tankFull = fuel.missingLiters < 0.5;
    this.refuelButton.disabled = tankFull || !fuel.atPump || (economy.credits === 0 && !fuel.isEmpty);
    setText(this.refuelButton, tankFull ? strings.t('hq.tankFull') : strings.t('hq.refuel', { cost: strings.money(fuel.fillUpCost()) }));

    setText(this.damageLabel, `${strings.percent(damage.damage)} · ${strings.t(`damage.${damage.band}`)}`);
    this.damageFill.style.transform = `scaleX(${damage.damage})`;
    const undamaged = damage.damage <= 0;
    this.repairButton.disabled = undamaged || !damage.atWorkshop || !economy.canAfford(damage.repairCost);
    setText(this.repairButton, undamaged ? strings.t('hq.noDamage') : strings.t('hq.repair', { cost: strings.money(damage.repairCost) }));

    for (const [tab, tabButton] of this.tabs) {
      tabButton.classList.toggle('is-selected', tab === this.tab);
      tabButton.setAttribute('aria-selected', String(tab === this.tab));
    }
    this.list.dataset.tab = this.tab;
    this.list.replaceChildren(...this.tabContent());
  }

  hide(): void {
    this.root.hidden = true;
  }

  dispose(): void {
    this.root.remove();
  }

  private tabContent(): HTMLElement[] {
    const document = this.root.ownerDocument;
    const { strings, actions } = this;
    const { missions, economy, garage, upgrades, specialEvents } = this.services;
    switch (this.tab) {
      case 'jobs': {
        const cards = sortJobOffers(missions.jobBoard()).map((offer) =>
          jobCard(
            document,
            strings,
            offer,
            actions.onAccept,
            offer.blockedBy === null ? specialEvents.eventsForContract(offer.mission.id) : [],
          ),
        );
        return cards.length > 0 ? cards : [element(document, 'p', 'hq__empty', strings.t('hq.noJobs'))];
      }
      case 'events':
        return [
          element(document, 'p', 'hq__note', strings.t('hq.events.note')),
          ...sortEvents(specialEvents.statuses()).map((status) => eventCard(document, strings, status)),
        ];
      case 'garage': {
        const owned = garage.trucks;
        const busy = missions.active !== null;
        return garage.dealer().map((offer) =>
          truckCard(
            document,
            strings,
            {
              offer,
              owned: owned.find((truck) => truck.definition.id === offer.definition.id),
              busy,
              canAfford: economy.canAfford(offer.price),
            },
            { onBuy: actions.onBuyTruck, onSwitch: actions.onSwitchTruck },
          ),
        );
      }
      case 'upgrades': {
        const truck = strings.vehicleName(garage.activeTruck.definition.id);
        return [
          element(document, 'p', 'hq__note', strings.t('hq.upgrades.for', { truck })),
          ...upgrades
            .offers()
            .map((offer) =>
              upgradeCard(document, strings, offer, offer.next !== null && economy.canAfford(offer.next.cost), actions.onBuyUpgrade),
            ),
        ];
      }
    }
  }
}

/** Where the truck stands, for the HQ's truck card: a depot, the rest area or the road. */
function locationText(strings: Strings, servicePoint: ServicePoint | null): string {
  if (servicePoint === null) {
    return strings.t('hq.location.road');
  }
  if (servicePoint.kind === 'restArea') {
    return strings.t('hq.location.restArea');
  }
  return strings.t('hq.location.depot', {
    depot: strings.t('depot.name', { city: strings.cityName(servicePoint.depot.cityId) }),
  });
}
