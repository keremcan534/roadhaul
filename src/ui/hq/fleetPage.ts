import { MAX_DRIVER_SKILL, type DriverDefinition } from '../../data/definitions/DriverDefinition';
import type { EconomyService } from '../../systems/economy/EconomyService';
import type { FleetJob } from '../../domain/fleet/fleetJobs';
import type { DriverActivity, DriverOffer, FleetDriverStatus, FleetService } from '../../systems/fleet/FleetService';
import type { MissionService } from '../../systems/missions/MissionService';
import type { GarageService, OwnedTruck } from '../../systems/vehicles/GarageService';
import { button, element, setText } from '../dom';
import type { Strings } from '../i18n';
import { truckSilhouette } from './truckSilhouette';

/** What the fleet page reads. It only reads them; changes go through the actions. */
export interface FleetPageServices {
  readonly garage: GarageService;
  readonly fleet: FleetService;
  readonly economy: EconomyService;
  readonly missions: MissionService;
}

export interface FleetPageActions {
  readonly onHire: (driverId: string) => void;
  readonly onDismiss: (driverId: string) => void;
  readonly onAssign: (driverId: string, instanceId: string) => void;
  readonly onBuyTruckFor: (driverId: string) => void;
  readonly onRecall: (driverId: string) => void;
  readonly onSwitch: (instanceId: string) => void;
}

/** A contract's or a repair's progress on the page, kept up to date while it shows (FleetPage.tick). */
interface LiveProgress {
  readonly driverId: string;
  readonly fill: HTMLElement;
  readonly label: HTMLElement;
  /** What the driver was doing when the page was drawn: a change needs it drawn again. */
  readonly job: FleetJob | null;
  readonly activity: DriverActivity;
}

/**
 * The company's fleet (spec §27), a page of the company panel: every truck
 * it owns, the one the player drives, those waiting in the garage (to send
 * out with a hired driver, or to drive) and those out with a driver, with
 * their contract, its progress and the way to call them back; then the
 * hired drivers with what they have brought in, and the drivers looking
 * for work, with their skill, pace, risk, share and fee.
 */
export class FleetPage {
  private readonly live: LiveProgress[] = [];

  constructor(
    private readonly document: Document,
    private readonly strings: Strings,
    private readonly services: FleetPageServices,
    private readonly actions: FleetPageActions,
  ) {}

  /** The page's content, afresh. */
  render(): HTMLElement[] {
    const { document, strings } = this;
    const { garage, fleet } = this.services;
    this.live.length = 0;
    const hired = fleet.hired;
    const trucks = garage.trucks;
    const onRoad = trucks.filter((truck) => truck.driverId !== null).length;
    const earned = hired.reduce((sum, driver) => sum + driver.creditsEarned, 0);
    const summary = element(document, 'p', 'hq__note fleet__summary');
    summary.dataset.value = 'fleet-summary';
    summary.textContent = strings.t('hq.fleet.summary', {
      onRoad,
      owned: trucks.length,
      earned: strings.money(earned),
    });

    const truckCards = element(document, 'div', 'hq__cards');
    truckCards.append(...trucks.map((truck) => this.truckCard(truck, hired)));
    const hiredCards = element(document, 'div', 'hq__cards');
    hiredCards.append(...hired.map((driver) => this.hiredCard(driver, trucks)));
    const marketCards = element(document, 'div', 'hq__cards');
    marketCards.append(...fleet.roster().filter((offer) => !offer.hired).map((offer) => this.marketCard(offer)));

    const page: HTMLElement[] = [element(document, 'p', 'hq__note', strings.t('hq.fleet.note')), summary];
    page.push(this.section('trucks', strings.t('hq.fleet.trucks'), truckCards));
    if (hired.length > 0) {
      page.push(this.section('drivers', strings.t('hq.fleet.drivers'), hiredCards));
    }
    if (marketCards.childElementCount > 0) {
      page.push(this.section('market', strings.t('hq.fleet.market'), marketCards));
    }
    return page;
  }

  /**
   * Moves the progress bars and the time left on, without rebuilding the
   * page. True when a driver has moved on to another contract, or to the
   * workshop, since the page was drawn: then it needs drawing again. Cheap;
   * call a few times a second.
   */
  tick(): boolean {
    if (this.live.length === 0) {
      return false;
    }
    const hired = this.services.fleet.hired;
    for (const entry of this.live) {
      const driver = hired.find((candidate) => candidate.definition.id === entry.driverId);
      if (driver === undefined || driver.job !== entry.job || driver.activity !== entry.activity) {
        return true;
      }
      entry.fill.style.transform = `scaleX(${driver.progress.toFixed(3)})`;
      setText(entry.label, this.strings.t('hq.fleet.timeLeft', { time: this.strings.duration(driver.secondsLeft) }));
    }
    return false;
  }

  private section(name: string, title: string, content: HTMLElement): HTMLElement {
    const node = element(this.document, 'section', `hq__section hq__section--${name}`);
    node.append(element(this.document, 'h3', 'hq__section-title', title), content);
    return node;
  }

  private truckCard(truck: OwnedTruck, hired: readonly FleetDriverStatus[]): HTMLElement {
    const { document, strings, actions } = this;
    const driver = truck.driverId === null ? undefined : hired.find((candidate) => candidate.definition.id === truck.driverId);
    const state = truck.active ? 'you' : driver === undefined ? 'idle' : driver.activity;
    const card = element(document, 'article', 'fleet-truck');
    card.dataset.instanceId = truck.instanceId;
    card.dataset.state = state;

    const top = element(document, 'div', 'fleet-truck__top');
    top.append(
      element(document, 'h3', 'fleet-truck__title', `${strings.vehicleName(truck.definition.id)} · ${truckNumber(truck.instanceId)}`),
      element(document, 'span', 'fleet-truck__damage', strings.t('hq.fleet.damage', { percent: strings.percent(truck.damage) })),
    );
    const picture = truckSilhouette(document, truck.definition, truck.paint?.color ?? truck.definition.factoryColor);
    const status = element(document, 'p', 'fleet-truck__status');
    const bottom = element(document, 'div', 'fleet-truck__actions');
    card.append(top, picture, status);

    if (truck.active) {
      status.textContent = strings.t('hq.fleet.you');
    } else if (driver === undefined) {
      status.textContent = strings.t('hq.fleet.idle');
      const waiting = hired.filter((candidate) => candidate.truckInstanceId === null);
      for (const free of waiting.slice(0, 3)) {
        const send = button(
          document,
          'button--primary fleet-truck__assign',
          strings.t('hq.fleet.assign', { driver: driverName(strings, free.definition) }),
          'assign-driver',
          () => actions.onAssign(free.definition.id, truck.instanceId),
        );
        send.dataset.driverId = free.definition.id;
        bottom.append(send);
      }
      if (waiting.length === 0) {
        card.append(element(document, 'p', 'fleet-truck__hint', strings.t('hq.fleet.noFreeDriver')));
      }
      const drive = button(document, 'button--secondary', strings.t('hq.fleet.drive'), 'drive-truck', () =>
        actions.onSwitch(truck.instanceId),
      );
      drive.disabled = this.services.missions.active !== null;
      bottom.append(drive);
    } else {
      const name = driverName(strings, driver.definition);
      const job = driver.job;
      status.textContent =
        driver.activity === 'inWorkshop'
          ? strings.t('hq.fleet.inWorkshop', { driver: name })
          : job === null
            ? strings.t('hq.fleet.settingOff', { driver: name })
            : strings.t('hq.fleet.onContract', {
                driver: name,
                from: strings.cityName(job.originCityId),
                to: strings.cityName(job.destinationCityId),
                cargo: strings.cargoName(job.cargoId),
              });
      card.append(this.progress(driver));
      const recall = button(document, 'button--secondary', strings.t('hq.fleet.recall'), 'recall-truck', () =>
        actions.onRecall(driver.definition.id),
      );
      recall.dataset.driverId = driver.definition.id;
      bottom.append(recall);
    }
    if (bottom.childElementCount > 0) {
      card.append(bottom);
    }
    return card;
  }

  private progress(driver: FleetDriverStatus): HTMLElement {
    const { document, strings } = this;
    const row = element(document, 'div', 'fleet-truck__progress');
    const meter = element(document, 'div', 'meter meter--fleet');
    const fill = element(document, 'div', 'meter__fill');
    fill.style.transform = `scaleX(${driver.progress.toFixed(3)})`;
    meter.append(fill);
    const label = element(document, 'span', 'fleet-truck__time', strings.t('hq.fleet.timeLeft', { time: strings.duration(driver.secondsLeft) }));
    row.append(meter, label);
    this.live.push({ driverId: driver.definition.id, fill, label, job: driver.job, activity: driver.activity });
    return row;
  }

  private hiredCard(driver: FleetDriverStatus, trucks: readonly OwnedTruck[]): HTMLElement {
    const { document, strings, actions } = this;
    const card = this.driverCard(driver.definition, true);
    const truck = trucks.find((candidate) => candidate.instanceId === driver.truckInstanceId);
    card.append(
      element(
        document,
        'p',
        'driver-card__status',
        truck === undefined
          ? strings.t('hq.fleet.waitingForTruck')
          : strings.t('hq.fleet.drives', { truck: `${strings.vehicleName(truck.definition.id)} · ${truckNumber(truck.instanceId)}` }),
      ),
      element(
        document,
        'p',
        'driver-card__record',
        strings.t('hq.fleet.record', { jobs: strings.number(driver.jobsCompleted), earned: strings.signedMoney(driver.creditsEarned) }),
      ),
    );
    const bottom = element(document, 'div', 'driver-card__bottom');
    if (truck === undefined) {
      bottom.append(this.truckFor(driver.definition.id, trucks));
    }
    const dismiss = button(document, 'button--secondary', strings.t('hq.fleet.dismiss'), 'dismiss-driver', () =>
      actions.onDismiss(driver.definition.id),
    );
    dismiss.dataset.driverId = driver.definition.id;
    bottom.append(dismiss);
    card.append(bottom);
    return card;
  }

  /**
   * For a hired driver without a truck: the truck waiting in the garage to
   * give them, else one to buy them (the cheapest on sale), else why not.
   */
  private truckFor(driverId: string, trucks: readonly OwnedTruck[]): HTMLElement {
    const { document, strings, actions } = this;
    const waiting = trucks.find((candidate) => !candidate.active && candidate.driverId === null);
    let control: HTMLButtonElement;
    if (waiting !== undefined) {
      control = button(
        document,
        'button--primary',
        strings.t('hq.fleet.give', { truck: `${strings.vehicleName(waiting.definition.id)} · ${truckNumber(waiting.instanceId)}` }),
        'give-truck',
        () => actions.onAssign(driverId, waiting.instanceId),
      );
      control.dataset.instanceId = waiting.instanceId;
    } else {
      const offer = this.services.fleet.truckToBuy();
      if (offer === null) {
        return element(document, 'p', 'driver-card__hint', strings.t('hq.fleet.garageFull', { count: this.services.garage.capacity }));
      }
      control = button(
        document,
        'button--primary',
        strings.t('hq.fleet.buyFor', { truck: strings.vehicleName(offer.definition.id), price: strings.money(offer.price) }),
        'buy-truck-for',
        () => actions.onBuyTruckFor(driverId),
      );
      control.dataset.vehicleId = offer.definition.id;
      control.disabled = !this.services.economy.canAfford(offer.price);
    }
    control.dataset.driverId = driverId;
    return control;
  }

  private marketCard(offer: DriverOffer): HTMLElement {
    const { document, strings, actions } = this;
    const { definition } = offer;
    const card = this.driverCard(definition, false);
    card.classList.toggle('is-locked', offer.locked);
    const bottom = element(document, 'div', 'driver-card__bottom');
    if (offer.locked) {
      bottom.append(
        element(document, 'span', 'driver-card__price', strings.money(definition.hiringFee)),
        element(document, 'span', 'driver-card__lock', strings.t('hq.locked', { level: offer.requiredCompanyLevel })),
      );
    } else {
      const hire = button(
        document,
        'button--primary',
        strings.t('hq.fleet.hire', { price: strings.money(definition.hiringFee) }),
        'hire-driver',
        () => actions.onHire(definition.id),
      );
      hire.dataset.driverId = definition.id;
      hire.disabled = !this.services.economy.canAfford(definition.hiringFee);
      bottom.append(hire);
    }
    card.append(bottom);
    return card;
  }

  /** The driver: initials, name, skill in stars, and their pace, accident risk and share of the pay. */
  private driverCard(definition: DriverDefinition, hired: boolean): HTMLElement {
    const { document, strings } = this;
    const card = element(document, 'article', 'driver-card');
    card.dataset.driverId = definition.id;
    card.dataset.hired = String(hired);
    const name = driverName(strings, definition);
    const top = element(document, 'div', 'driver-card__top');
    const avatar = element(document, 'span', 'driver-card__avatar', initials(name));
    avatar.dataset.skill = String(definition.skill);
    const stars = element(document, 'span', 'driver-card__stars', '★'.repeat(definition.skill) + '☆'.repeat(MAX_DRIVER_SKILL - definition.skill));
    stars.setAttribute('aria-label', `${strings.t('hq.fleet.skill')} ${definition.skill}/${MAX_DRIVER_SKILL}`);
    top.append(avatar, element(document, 'h3', 'driver-card__name', name), stars);
    const facts = element(document, 'dl', 'driver-card__facts');
    const pace = Math.round((definition.speedFactor - 1) * 100);
    for (const [label, value] of [
      [strings.t('hq.fleet.pace'), `${pace > 0 ? '+' : pace < 0 ? '−' : '±'}${Math.abs(pace)}%`],
      [strings.t('hq.fleet.risk'), strings.percent(definition.incidentChance)],
      [strings.t('hq.fleet.share'), strings.percent(definition.payShare)],
    ] as const) {
      const fact = element(document, 'div', 'driver-card__fact');
      fact.append(element(document, 'dt', '', label), element(document, 'dd', '', value));
      facts.append(fact);
    }
    card.append(top, facts);
    return card;
  }
}

/** A driver's name from the string tables. */
export function driverName(strings: Strings, definition: Pick<DriverDefinition, 'id'>): string {
  return strings.t(`driver.${definition.id}.name`);
}

/** "#2" for truck_002: the company's trucks are told apart by their number. */
export function truckNumber(instanceId: string): string {
  const number = /\d+$/.exec(instanceId)?.[0];
  return number === undefined ? instanceId : `#${Number(number)}`;
}

/** "KA" for "Kemal A.". */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toLocaleUpperCase();
}
