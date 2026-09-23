import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { finiteOr } from '../../core/math/scalar';
import { err, ok, type Result } from '../../core/Result';
import type { GameConfig } from '../../data/config/GameConfig';
import type { Credits, Fraction } from '../../data/units';
import type { SpendError } from '../../domain/economy/CurrencyWallet';
import { fuelUsedLiters } from '../../domain/vehicles/fuelConsumption';
import { MAX_SAVING } from '../../domain/vehicles/upgradeBonuses';
import type { DrivingService } from '../driving/DrivingService';
import type { EconomyService } from '../economy/EconomyService';
import type { GameEvents } from '../GameEvents';
import type { DamageService } from './DamageService';

/** A stranded player who cannot pay gets this much fuel for free, so a broke company is never stuck. */
export const EMERGENCY_FUEL_LITERS = 15;

/** tankFull: nothing to fill; notAtServicePoint: the pump is only at depots and rest areas (call a fuel truck instead). */
export type RefuelError = 'tankFull' | 'notAtServicePoint' | SpendError;

/** What a refuelling bought. */
export interface Refuelled {
  readonly liters: number;
  readonly cost: Credits;
}

/**
 * The active truck's fuel (spec §17; roadmap step 15). Every fixed step it
 * burns fuel for the distance driven, by the spec formula. An empty tank
 * stalls the engine. Refuelling costs money: at the pump of a depot or rest
 * area, or brought out to the road at a higher price.
 */
export class FuelService {
  private liters = 0;
  private lastOdometerMeters = 0;
  private shownPercent = -1;
  /** Tank size relative to the definition: the fuel tank upgrade. */
  private capacityFactor = 1;
  /** Share of the formula's consumption actually burnt: the engine upgrade saves some. */
  private consumptionFactor = 1;

  constructor(
    private readonly driving: DrivingService,
    private readonly damage: DamageService,
    private readonly economy: EconomyService,
    private readonly events: EventBus<GameEvents>,
    private readonly config: GameConfig['fuel'],
    private readonly logger: Logger,
  ) {}

  get fuelLiters(): number {
    return this.liters;
  }

  /** Tank size of the truck being driven, with its fuel tank upgrade (0 when nothing is driven). */
  get capacityLiters(): number {
    return this.driving.isDriving ? this.driving.definition.fuelCapacityLiters * this.capacityFactor : 0;
  }

  get fraction(): Fraction {
    const capacity = this.capacityLiters;
    return capacity > 0 ? this.liters / capacity : 0;
  }

  get isLow(): boolean {
    return this.fraction < this.config.lowFuelFraction;
  }

  get isEmpty(): boolean {
    return this.liters <= 0;
  }

  /** Litres a full tank still needs. */
  get missingLiters(): number {
    return Math.max(0, this.capacityLiters - this.liters);
  }

  /**
   * The active truck's upgrade bonuses (GarageService): a bigger tank, and a
   * share of the consumption saved. A smaller tank than before keeps what fits.
   */
  setUpgradeBonuses(fuelCapacityBonus: number, fuelEfficiencyBonus: number): void {
    this.capacityFactor = 1 + Math.max(0, finiteOr(fuelCapacityBonus, 0));
    this.consumptionFactor = 1 - Math.min(MAX_SAVING, Math.max(0, finiteOr(fuelEfficiencyBonus, 0)));
    if (this.liters > this.capacityLiters) {
      this.liters = this.capacityLiters;
    }
    this.announce(true);
  }

  /** Takes over a loaded or new truck's fuel. Call after the truck is on the map and its upgrades are set. */
  restore(liters: number): void {
    this.liters = Math.min(this.capacityLiters, Math.max(0, liters));
    this.lastOdometerMeters = this.driving.isDriving ? this.driving.vehicle.odometerMeters : 0;
    this.shownPercent = -1;
    this.driving.setEngineRunning(this.liters > 0);
    this.announce(true);
  }

  /** Burns fuel for the distance driven since the last step. Call every fixed step after DrivingService.step(). Allocation-free. */
  update(): void {
    if (!this.driving.isDriving) {
      return;
    }
    const vehicle = this.driving.vehicle;
    const distance = vehicle.odometerMeters - this.lastOdometerMeters;
    this.lastOdometerMeters = vehicle.odometerMeters;
    if (!(distance > 0) || this.liters <= 0) {
      return;
    }
    const burnt = fuelUsedLiters(
      distance,
      this.driving.definition,
      this.driving.cargoMassKg / 1000,
      this.driving.surface.fuelFactor,
      vehicle.speed,
      this.damage.damage,
      this.config.consumptionScale * this.consumptionFactor,
    );
    this.liters = Math.max(0, this.liters - burnt);
    if (this.liters <= 0) {
      this.driving.setEngineRunning(false);
      this.logger.info('Out of fuel: the engine stalled.');
    }
    this.announce(false);
  }

  /** What filling the tank costs, at the pump or on the road. */
  fillUpCost(roadside = false): Credits {
    return this.economy.fuelCost(this.missingLiters, roadside);
  }

  /** Whether the pump is in reach: the truck stands in a depot yard or at a rest area. */
  get atPump(): boolean {
    return this.driving.servicePoint !== null;
  }

  /**
   * Fills the tank, or as much of it as the company can pay for: at the pump
   * of a depot or rest area, or anywhere from a fuel truck at the roadside
   * price. A stranded truck whose company cannot pay for a single litre gets
   * emergency fuel for free.
   */
  refuel(roadside = false): Result<Refuelled, RefuelError> {
    const missing = this.missingLiters;
    if (missing < 0.5) {
      return err('tankFull');
    }
    if (!roadside && !this.atPump) {
      return err('notAtServicePoint');
    }
    let liters = missing;
    let cost = this.economy.fuelCost(liters, roadside);
    if (!this.economy.canAfford(cost)) {
      liters = Math.min(missing, this.economy.litersAffordable(this.economy.credits, roadside));
      cost = this.economy.fuelCost(liters, roadside);
    }
    if (liters <= 0) {
      if (!this.isEmpty) {
        return err('insufficientFunds');
      }
      liters = Math.min(missing, EMERGENCY_FUEL_LITERS);
      cost = 0;
      this.logger.info(`Emergency fuel: ${liters} L for free.`);
    }
    const paid = this.economy.spend(cost, 'fuel');
    if (!paid.ok) {
      return err(paid.error);
    }
    this.liters = Math.min(this.capacityLiters, this.liters + liters);
    this.driving.setEngineRunning(true);
    this.announce(true);
    this.events.emit('Refuelled', { liters, cost });
    return ok({ liters, cost });
  }

  /** Emits FuelChanged when the whole percent shown changes, or always when `force`. */
  private announce(force: boolean): void {
    const fraction = this.fraction;
    const percent = Math.floor(fraction * 100);
    if (!force && percent === this.shownPercent && this.liters > 0) {
      return;
    }
    this.shownPercent = percent;
    this.events.emit('FuelChanged', { liters: this.liters, fraction });
  }
}
