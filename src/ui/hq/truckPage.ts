import type { ContentCatalog } from '../../data/ContentCatalog';
import { isCargoAboard } from '../../domain/missions/MissionInstance';
import type { ServicePoint } from '../../domain/world/DrivingWorld';
import type { DrivingService } from '../../systems/driving/DrivingService';
import type { EconomyService } from '../../systems/economy/EconomyService';
import type { MissionService } from '../../systems/missions/MissionService';
import type { DamageService } from '../../systems/vehicles/DamageService';
import type { FuelService } from '../../systems/vehicles/FuelService';
import type { GarageService } from '../../systems/vehicles/GarageService';
import type { UpgradeService } from '../../systems/vehicles/UpgradeService';
import { button, element } from '../dom';
import type { Strings } from '../i18n';
import { cargoIcon, icon, upgradeIcon, type IconName } from '../icons';
import { truckSilhouette } from './truckSilhouette';

/** What the truck page reads. It only reads them; changes go through the actions. */
export interface TruckPageServices {
  readonly content: ContentCatalog;
  readonly driving: DrivingService;
  readonly missions: MissionService;
  readonly economy: EconomyService;
  readonly fuel: FuelService;
  readonly damage: DamageService;
  readonly garage: GarageService;
  readonly upgrades: UpgradeService;
}

export interface TruckPageActions {
  readonly onRefuel: () => void;
  readonly onRepair: () => void;
}

/**
 * The truck being driven, in the game (tester feedback: its state belongs in
 * the game): which truck, where it stands, its fuel and damage with the pump
 * and the workshop where it stands at one, what it carries, and the parts
 * its upgrades have fitted.
 */
export function truckPage(
  document: Document,
  strings: Strings,
  services: TruckPageServices,
  actions: TruckPageActions,
): HTMLElement[] {
  const { driving, economy, fuel, damage, garage } = services;
  const truck = garage.activeTruck;
  const definition = truck.definition;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) =>
    element(document, tag, className, text);

  const head = el('section', 'truck-page__head');
  const identity = el('div', 'truck-page__identity');
  const servicePoint = driving.servicePoint;
  const location = el('p', 'hq__truck-location');
  location.append(icon(document, 'pin'), el('span', '', locationText(strings, servicePoint)));
  const serviceNote = el('p', 'hq__service-note', strings.t('hq.serviceAway'));
  serviceNote.hidden = servicePoint !== null;
  identity.append(
    el('p', 'hq__truck-name', `${strings.vehicleName(definition.id)} · ${strings.t(`body.${definition.bodyType}`)}`),
    location,
    serviceNote,
  );
  head.append(truckSilhouette(document, definition, truck.paint?.color ?? definition.factoryColor), identity);

  const gauges = el('section', 'truck-page__gauges');
  const gauge = (
    name: IconName,
    title: string,
    value: string,
    fraction: number,
    meterClass: string,
    action: HTMLButtonElement,
  ): HTMLElement => {
    const row = el('div', `truck-gauge truck-gauge--${name}`);
    const top = el('div', 'truck-gauge__top');
    top.append(icon(document, name), el('span', 'truck-gauge__title', title), el('span', 'truck-gauge__value', value));
    const meter = el('div', `meter meter--big ${meterClass}`);
    const fill = el('div', 'meter__fill');
    fill.style.transform = `scaleX(${fraction})`;
    meter.append(fill);
    row.append(top, meter, action);
    return row;
  };
  const tankFull = fuel.missingLiters < 0.5;
  const refuel = button(
    document,
    'button--secondary hq__service',
    tankFull ? strings.t('hq.tankFull') : strings.t('hq.refuel', { cost: strings.money(fuel.fillUpCost()) }),
    'refuel',
    actions.onRefuel,
  );
  refuel.disabled = tankFull || !fuel.atPump || (economy.credits === 0 && !fuel.isEmpty);
  const undamaged = damage.damage <= 0;
  const repair = button(
    document,
    'button--secondary hq__service',
    undamaged ? strings.t('hq.noDamage') : strings.t('hq.repair', { cost: strings.money(damage.repairCost) }),
    'repair',
    actions.onRepair,
  );
  repair.disabled = undamaged || !damage.atWorkshop || !economy.canAfford(damage.repairCost);
  const fuelRow = gauge(
    'fuel',
    strings.t('hq.fuel'),
    `${strings.percent(fuel.fraction)} · ${strings.t('format.liters', { value: Math.round(fuel.fuelLiters) })}`,
    fuel.fraction,
    fuel.isLow ? 'meter--fuel is-low' : 'meter--fuel',
    refuel,
  );
  const damageRow = gauge(
    'wrench',
    strings.t('hq.damage'),
    `${strings.percent(damage.damage)} · ${strings.t(`damage.${damage.band}`)}`,
    damage.damage,
    'meter--damage',
    repair,
  );
  gauges.append(fuelRow, damageRow);

  return [head, gauges, cargoSection(document, strings, services), partsSection(document, strings, services)];
}

/** What the truck carries: nothing, a load to pick up, or the load aboard and how it has travelled. */
function cargoSection(document: Document, strings: Strings, services: TruckPageServices): HTMLElement {
  const { missions, content } = services;
  const section = element(document, 'section', 'truck-page__cargo');
  const mission = missions.active;
  const definition = missions.activeDefinition;
  const target = missions.target;
  const text = element(document, 'div', 'truck-page__cargo-text');
  text.append(element(document, 'h3', 'hq__section-title', strings.t('hq.cargo')));
  if (mission === null || definition === null) {
    section.append(icon(document, 'cargo', 'truck-page__cargo-icon'), text);
    text.append(element(document, 'p', 'truck-page__cargo-line', strings.t('hq.cargo.empty')));
    return section;
  }
  const cargo = content.cargo.get(definition.cargoId);
  const load = { cargo: strings.cargoName(cargo.id), tons: strings.tons(definition.cargoWeightTons) };
  const depot = target === null ? '' : strings.t('depot.name', { city: strings.cityName(target.depot.cityId) });
  section.append(icon(document, cargoIcon(cargo.category), 'truck-page__cargo-icon'), text);
  if (isCargoAboard(mission)) {
    text.append(
      element(document, 'p', 'truck-page__cargo-line', strings.t('hq.cargo.aboard', load)),
      element(
        document,
        'p',
        'truck-page__cargo-note',
        strings.t('hq.cargo.deliver', { depot, percent: strings.percent(1 - mission.cargoDamage) }),
      ),
    );
  } else {
    text.append(
      element(document, 'p', 'truck-page__cargo-line', strings.t('hq.cargo.toLoad', load)),
      element(document, 'p', 'truck-page__cargo-note', strings.t('hq.cargo.pickup', { depot })),
    );
  }
  return section;
}

/** The parts the truck's upgrades have fitted, each with its level. */
function partsSection(document: Document, strings: Strings, services: TruckPageServices): HTMLElement {
  const section = element(document, 'section', 'truck-page__parts');
  section.append(
    element(document, 'h3', 'hq__section-title', strings.t('hq.parts')),
    element(document, 'p', 'hq__note', strings.t('hq.parts.note')),
  );
  const grid = element(document, 'div', 'truck-page__part-grid');
  for (const offer of services.upgrades.offers()) {
    const { upgrade, fittedLevel } = offer;
    const part = element(document, 'div', fittedLevel > 0 ? 'truck-part is-fitted' : 'truck-part');
    part.dataset.upgradeId = upgrade.id;
    const pips = element(document, 'span', 'upgrade-card__pips');
    pips.setAttribute('aria-label', strings.t('hq.upgrades.level', { level: fittedLevel, max: upgrade.levels.length }));
    for (let level = 1; level <= upgrade.levels.length; level++) {
      pips.append(element(document, 'span', level <= fittedLevel ? 'pip is-on' : 'pip'));
    }
    part.append(icon(document, upgradeIcon(upgrade.look)), element(document, 'span', 'truck-part__name', strings.upgradeName(upgrade.id)), pips);
    grid.append(part);
  }
  section.append(grid);
  return section;
}

/** Where the truck stands: a depot, the rest area or the road. */
export function locationText(strings: Strings, servicePoint: ServicePoint | null): string {
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
