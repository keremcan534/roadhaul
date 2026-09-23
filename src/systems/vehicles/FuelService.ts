import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { GameConfig } from '../../data/config/GameConfig';
import type { Credits, Fraction } from '../../data/units';
import type { SpendError } from '../../domain/economy/CurrencyWallet';
import { fuelUsedLiters } from '../../domain/vehicles/fuelConsumption';
import type { DrivingService } from '../driving/DrivingService';
import type { EconomyService } from '../economy/EconomyService';
import type { GameEvents } from '../GameEvents';
import type { DamageService } from './DamageService';

/** A stranded player who cannot pay gets this much fuel for free, so a broke company is never stuck. */
export const EMERGENCY_FUEL_LITERS = 15;

export type RefuelError = 'tankFull' | SpendError;

/** What a refuelling bought. */
export interface Refuelled {
  readonly liters: number;
  readonly cost: Credits;
}

/**
 * The active truck's fuel (spec §17; roadmap step 15). Every fixed step it
 * burns fuel for the distance driven, by the spec formula. An empty tank
 * stalls the engine. Refuelling costs money: at the depot pump (the HQ) or
 * brought out to the road at a higher price.
 */
export class FuelService {
  private liters = 0;
  private lastOdometerMeters = 0;
  private shownPercent = -1;

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

  /** Tank size of the truck being driven (0 when nothing is driven). */
  get capacityLiters(): number {
    return this.driving.isDriving ? this.driving.definition.fuelCapacityLiters : 0;
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

  /** Takes over a loaded or new truck's fuel. Call after the truck is on the map. */
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
      this.config.consumptionScale,
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

  /**
   * Fills the tank, or as much of it as the company can pay for. A stranded
   * truck whose company cannot pay for a single litre gets emergency fuel for
   * free.
   */
  refuel(roadside = false): Result<Refuelled, RefuelError> {
    const missing = this.missingLiters;
    if (missing < 0.5) {
      return err('tankFull');
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
