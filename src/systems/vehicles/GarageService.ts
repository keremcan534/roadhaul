import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import type { Credits, Fraction } from '../../data/units';
import type { SpendError } from '../../domain/economy/CurrencyWallet';
import { formatVehicleInstanceId } from '../../domain/save/createNewSaveGameData';
import type { GarageSaveData } from '../../domain/save/SaveGameData';
import {
  fittedUpgradeLevel,
  statBonuses,
  upgradePerformance,
  type FittedUpgrades,
  type StatBonuses,
} from '../../domain/vehicles/upgradeBonuses';
import type { DrivingService } from '../driving/DrivingService';
import type { EconomyService } from '../economy/EconomyService';
import type { GameEvents } from '../GameEvents';
import type { CompanyLevelSource, MissionService } from '../missions/MissionService';
import type { DamageService } from './DamageService';
import type { FuelService } from './FuelService';

export type BuyTruckError = 'unknownVehicle' | 'alreadyOwned' | 'locked' | SpendError;
export type SwitchTruckError = 'unknownTruck' | 'alreadyActive' | 'missionInProgress';

/** A truck the company owns. The active truck's fuel and damage are live. */
export interface OwnedTruck {
  readonly instanceId: string;
  readonly definition: VehicleDefinition;
  readonly fuelLiters: number;
  readonly damage: Fraction;
  readonly upgrades: FittedUpgrades;
  /** The truck the player drives. */
  readonly active: boolean;
}

/** A truck model at the dealer (spec §15). */
export interface TruckOffer {
  readonly definition: VehicleDefinition;
  readonly price: Credits;
  /** The company level that lets the dealer sell it (spec §14). */
  readonly requiredCompanyLevel: number;
  /** Below that level: shown, but not for sale yet. */
  readonly locked: boolean;
  /** The company has one already. */
  readonly owned: boolean;
}

/** One owned truck. The active one's fuel and damage live in FuelService and DamageService while it is driven. */
interface TruckRecord {
  readonly instanceId: string;
  readonly definition: VehicleDefinition;
  fuelLiters: number;
  damage: Fraction;
  upgrades: Record<string, number>;
}

/** Where the upgrades' effects go: the systems that drive the active truck. */
const UPGRADE_MODIFIER_SOURCE = 'upgrades';

/**
 * The company's trucks and the one the player drives (spec §15, §32
 * GarageState; roadmap step 19). The dealer sells each model once, from its
 * company level. Switching puts the other truck where the active one stands,
 * with its own fuel, damage and upgrades; never in the middle of a contract.
 *
 * It also fits the active truck's upgrades (spec §16): their bonuses go to
 * DrivingService (engine, brakes, grip, stability), FuelService (tank,
 * consumption) and MissionService (cargo protection). UpgradeService sells them.
 */
export class GarageService {
  private records: TruckRecord[] = [];
  private activeId = '';

  constructor(
    private readonly content: ContentCatalog,
    private readonly driving: DrivingService,
    private readonly missions: MissionService,
    private readonly fuel: FuelService,
    private readonly damage: DamageService,
    private readonly economy: EconomyService,
    private readonly company: CompanyLevelSource,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {}

  /** Every owned truck, in the order they were acquired. */
  get trucks(): readonly OwnedTruck[] {
    return this.records.map((record) => this.view(record));
  }

  /** The truck the player drives. Throws before a game is loaded. */
  get activeTruck(): OwnedTruck {
    return this.view(this.requireActive());
  }

  /** The upgrade bonuses of the truck the player drives. */
  get activeBonuses(): StatBonuses {
    return statBonuses(this.requireActive().upgrades, this.content.upgrades.all);
  }

  /** Every model the dealer knows, in content order. */
  dealer(): readonly TruckOffer[] {
    return this.content.vehicles.all.map((definition) => {
      const requiredCompanyLevel = definition.requiredCompanyLevel ?? 1;
      return {
        definition,
        price: definition.purchasePrice,
        requiredCompanyLevel,
        locked: this.company.level < requiredCompanyLevel,
        owned: this.records.some((record) => record.definition.id === definition.id),
      };
    });
  }

  /** Buys a model at the dealer. It waits in the garage, full and without upgrades. */
  buy(definitionId: string): Result<OwnedTruck, BuyTruckError> {
    const offer = this.dealer().find((candidate) => candidate.definition.id === definitionId);
    if (offer === undefined) {
      return err('unknownVehicle');
    }
    if (offer.owned) {
      return err('alreadyOwned');
    }
    if (offer.locked) {
      return err('locked');
    }
    const paid = this.economy.spend(offer.price, 'vehicle');
    if (!paid.ok) {
      return err(paid.error);
    }
    const record: TruckRecord = {
      instanceId: this.nextInstanceId(),
      definition: offer.definition,
      fuelLiters: offer.definition.fuelCapacityLiters,
      damage: 0,
      upgrades: {},
    };
    this.records.push(record);
    this.logger.info(`Bought ${definitionId} as ${record.instanceId} for ${offer.price}.`);
    this.events.emit('VehiclePurchased', {
      instanceId: record.instanceId,
      definitionId,
      price: offer.price,
    });
    return ok(this.view(record));
  }

  /** Drives another owned truck from now on. It takes the active truck's place on the map. */
  switchTo(instanceId: string): Result<OwnedTruck, SwitchTruckError> {
    const next = this.records.find((record) => record.instanceId === instanceId);
    if (next === undefined) {
      return err('unknownTruck');
    }
    if (instanceId === this.activeId) {
      return err('alreadyActive');
    }
    if (this.missions.active !== null) {
      return err('missionInProgress');
    }
    const previous = this.requireActive();
    previous.fuelLiters = this.fuel.fuelLiters;
    previous.damage = this.damage.damage;
    this.activeId = instanceId;
    this.driving.switchVehicle(next.definition.id);
    this.takeOver(next);
    this.logger.info(`Now driving ${instanceId} (${next.definition.id}).`);
    this.events.emit('ActiveVehicleChanged', { instanceId, definitionId: next.definition.id });
    return ok(this.view(next));
  }

  /** The level of `upgradeId` fitted to the active truck, 0 for none. */
  fittedLevel(upgradeId: string): number {
    const upgrade = this.content.upgrades.find(upgradeId);
    return upgrade === undefined ? 0 : fittedUpgradeLevel(this.requireActive().upgrades, upgrade);
  }

  /** Fits level `level` of `upgradeId` to the active truck (UpgradeService, after payment). */
  fitUpgrade(upgradeId: string, level: number): void {
    const upgrade = this.content.upgrades.get(upgradeId);
    if (!Number.isInteger(level) || level < 1 || level > upgrade.levels.length) {
      throw new RangeError(`${upgradeId} has no level ${level}.`);
    }
    this.requireActive().upgrades[upgradeId] = level;
    this.applyUpgrades();
  }

  /**
   * Takes over the garage of a loaded or new game. The active truck must
   * already be on the map (DrivingService.start); it gets its upgrades, fuel
   * and damage.
   */
  restore(garage: GarageSaveData): void {
    this.records = garage.vehicles.map((vehicle) => ({
      instanceId: vehicle.instanceId,
      definition: this.content.vehicles.get(vehicle.definitionId),
      fuelLiters: vehicle.fuelLiters,
      damage: vehicle.damage,
      upgrades: { ...vehicle.upgrades },
    }));
    this.activeId = garage.activeVehicleInstanceId;
    const active = this.requireActive();
    if (this.driving.definition.id !== active.definition.id) {
      throw new Error(`The truck on the map is ${this.driving.definition.id}, not the active ${active.definition.id}.`);
    }
    this.takeOver(active);
  }

  /** The garage as save data, with the active truck's live fuel and damage. */
  snapshot(): GarageSaveData {
    return {
      activeVehicleInstanceId: this.activeId,
      vehicles: this.records.map((record) => {
        const truck = this.view(record);
        return {
          instanceId: truck.instanceId,
          definitionId: truck.definition.id,
          fuelLiters: truck.fuelLiters,
          damage: truck.damage,
          upgrades: { ...truck.upgrades },
        };
      }),
    };
  }

  /** Makes `record`, now on the map, the truck the systems drive: its upgrades first, so its tank is the right size. */
  private takeOver(record: TruckRecord): void {
    this.applyUpgrades();
    this.damage.restore(record.damage);
    this.fuel.restore(record.fuelLiters);
  }

  private applyUpgrades(): void {
    const bonuses = this.activeBonuses;
    this.driving.setPerformanceModifier(UPGRADE_MODIFIER_SOURCE, upgradePerformance(bonuses));
    this.fuel.setUpgradeBonuses(bonuses.fuelCapacity, bonuses.fuelEfficiency);
    this.missions.setCargoProtection(bonuses.cargoProtection);
  }

  private view(record: TruckRecord): OwnedTruck {
    const active = record.instanceId === this.activeId;
    return {
      instanceId: record.instanceId,
      definition: record.definition,
      fuelLiters: active ? this.fuel.fuelLiters : record.fuelLiters,
      damage: active ? this.damage.damage : record.damage,
      upgrades: { ...record.upgrades },
      active,
    };
  }

  /** One more than the highest truck number so far: ids are never reused. */
  private nextInstanceId(): string {
    let highest = 0;
    for (const record of this.records) {
      highest = Math.max(highest, Number(/\d+$/.exec(record.instanceId)?.[0] ?? 0));
    }
    return formatVehicleInstanceId(highest + 1);
  }

  private requireActive(): TruckRecord {
    const active = this.records.find((record) => record.instanceId === this.activeId);
    if (active === undefined) {
      throw new Error('The garage has no active truck: no game is loaded.');
    }
    return active;
  }
}
