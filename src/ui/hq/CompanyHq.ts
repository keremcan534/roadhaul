import type { MissionDefinition } from '../../data/definitions/MissionDefinition';
import type { CompanyService } from '../../systems/company/CompanyService';
import type { EconomyService } from '../../systems/economy/EconomyService';
import type { JobOffer, MissionService } from '../../systems/missions/MissionService';
import type { DamageService } from '../../systems/vehicles/DamageService';
import type { FuelService } from '../../systems/vehicles/FuelService';
import { button, element, setText } from '../dom';
import type { Strings } from '../i18n';

/** What the HQ shows. It only reads them; changes go through the actions. */
export interface CompanyHqServices {
  readonly missions: MissionService;
  readonly economy: EconomyService;
  readonly company: CompanyService;
  readonly fuel: FuelService;
  readonly damage: DamageService;
}

export interface CompanyHqActions {
  readonly onAccept: (missionId: string) => void;
  readonly onRefuel: () => void;
  readonly onRepair: () => void;
  readonly onFreeDrive: () => void;
  readonly onMainMenu: () => void;
}

/**
 * The company HQ (spec §26): the company's name, level, XP, reputation and
 * credits; the truck's fuel and damage with refuelling and repairs; and the
 * job board (spec §28), where contracts above the company's level show what
 * unlocks them.
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
  private readonly list: HTMLDivElement;

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
    truck.append(el('h3', 'hq__card-title', strings.t('hq.truck')), fuelRow, this.refuelButton, damageRow, this.repairButton);

    side.append(company, truck);

    // The board's header row keeps the way out in sight however long the columns get.
    const board = el('section', 'hq__board');
    const header = el('div', 'hq__board-header');
    const tools = el('div', 'hq__tools');
    tools.append(
      button(document, 'button--ghost', strings.t('hq.mainMenu'), 'main-menu', actions.onMainMenu),
      button(document, 'button--secondary', strings.t('hq.freeDrive'), 'free-drive', actions.onFreeDrive),
    );
    header.append(el('h2', 'hq__board-title', strings.t('hq.jobBoard')), tools);
    this.list = el('div', 'hq__jobs');
    board.append(header, this.list);
    this.root.append(side, board);
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Opens the HQ with fresh figures and the current job board. */
  show(): void {
    this.refresh();
    this.list.scrollTop = 0;
    this.root.hidden = false;
  }

  /** Redraws the figures and the job board (after a purchase, a level-up, a delivery). Not per frame. */
  refresh(): void {
    const { company, economy, fuel, damage, missions } = this.services;
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

    setText(this.fuelLabel, `${strings.percent(fuel.fraction)} · ${strings.t('format.liters', { value: Math.round(fuel.fuelLiters) })}`);
    this.fuelFill.style.transform = `scaleX(${fuel.fraction})`;
    this.fuelFill.parentElement!.classList.toggle('is-low', fuel.isLow);
    const tankFull = fuel.missingLiters < 0.5;
    this.refuelButton.disabled = tankFull || (economy.credits === 0 && !fuel.isEmpty);
    setText(this.refuelButton, tankFull ? strings.t('hq.tankFull') : strings.t('hq.refuel', { cost: strings.money(fuel.fillUpCost()) }));

    setText(this.damageLabel, `${strings.percent(damage.damage)} · ${strings.t(`damage.${damage.band}`)}`);
    this.damageFill.style.transform = `scaleX(${damage.damage})`;
    const undamaged = damage.damage <= 0;
    this.repairButton.disabled = undamaged || !economy.canAfford(damage.repairCost);
    setText(this.repairButton, undamaged ? strings.t('hq.noDamage') : strings.t('hq.repair', { cost: strings.money(damage.repairCost) }));

    const document = this.root.ownerDocument;
    const offers = missions.jobBoard();
    const cards = offers.map((offer) => this.card(document, offer));
    if (cards.length === 0) {
      cards.push(element(document, 'p', 'hq__empty', strings.t('hq.noJobs')));
    }
    this.list.replaceChildren(...cards);
  }

  hide(): void {
    this.root.hidden = true;
  }

  dispose(): void {
    this.root.remove();
  }

  private card(document: Document, offer: JobOffer): HTMLElement {
    const { mission, cargo } = offer;
    const strings = this.strings;
    const card = element(document, 'article', offer.locked ? 'job-card is-locked' : 'job-card');
    card.dataset.missionId = mission.id;

    const top = element(document, 'div', 'job-card__top');
    top.append(
      element(document, 'h3', 'job-card__title', strings.missionTitle(mission.id)),
      element(document, 'span', `badge badge--${mission.difficulty}`, strings.t(`difficulty.${mission.difficulty}`)),
    );
    const route = element(document, 'p', 'job-card__route', routeText(strings, mission));
    const load = element(
      document,
      'p',
      'job-card__cargo',
      `${strings.cargoName(cargo.id)} · ${strings.tons(mission.cargoWeightTons)}`,
    );
    const facts = element(document, 'dl', 'job-card__facts');
    for (const [label, value] of [
      [strings.t('hq.distance'), strings.distance(offer.distanceMeters)],
      [strings.t('hq.timeLimit'), strings.duration(mission.timeLimitSeconds)],
    ] as const) {
      const fact = element(document, 'div', 'job-card__fact');
      fact.append(element(document, 'dt', '', label), element(document, 'dd', '', value));
      facts.append(fact);
    }
    const bottom = element(document, 'div', 'job-card__bottom');
    bottom.append(element(document, 'span', 'job-card__pay', strings.money(offer.basePay)));
    if (offer.locked) {
      bottom.append(element(document, 'span', 'job-card__locked', strings.t('hq.locked', { level: offer.requiredCompanyLevel })));
    } else {
      bottom.append(
        button(document, 'button--primary job-card__accept', strings.t('hq.accept'), 'accept', () =>
          this.actions.onAccept(mission.id),
        ),
      );
    }
    card.append(top, route, load, facts, bottom);
    return card;
  }
}

/** "Yeniliman → Demirkent". */
export function routeText(strings: Strings, mission: MissionDefinition): string {
  return `${strings.cityName(mission.originCityId)} → ${strings.cityName(mission.destinationCityId)}`;
}
