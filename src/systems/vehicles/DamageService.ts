import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { Credits, Fraction } from '../../data/units';
import type { SpendError } from '../../domain/economy/CurrencyWallet';
import {
  damageBand,
  damagePerformance,
  truckDamageFromImpact,
  type DamageBand,
} from '../../domain/vehicles/vehicleDamage';
import type { DrivingService } from '../driving/DrivingService';
import type { EconomyService } from '../economy/EconomyService';
import type { GameEvents } from '../GameEvents';

/** notDamaged: nothing to repair; notAtServicePoint: workshops are at depots and rest areas. */
export type RepairError = 'notDamaged' | 'notAtServicePoint' | SpendError;

/**
 * The active truck's condition (spec §18; roadmap step 16). Collisions wear
 * it down; damage weakens the engine and brakes (never to nothing) and makes
 * the truck thirstier (FuelService reads `damage`). Repairs cost money.
 */
export class DamageService {
  private currentDamage: Fraction = 0;
  private readonly unsubscribe: Unsubscribe;

  constructor(
    private readonly driving: DrivingService,
    private readonly economy: EconomyService,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {
    this.unsubscribe = events.on('VehicleCollided', ({ impactSpeedMetersPerSecond }) =>
      this.onCollision(impactSpeedMetersPerSecond),
    );
    this.applyPerformance();
  }

  get damage(): Fraction {
    return this.currentDamage;
  }

  get band(): DamageBand {
    return damageBand(this.currentDamage);
  }

  /** What a full repair costs now. */
  get repairCost(): Credits {
    return this.economy.repairCost(this.currentDamage);
  }

  /** Takes over a loaded or new truck's damage. */
  restore(damage: Fraction): void {
    this.currentDamage = Math.min(1, Math.max(0, damage));
    this.applyPerformance();
  }

  /** Whether a workshop is in reach: the truck stands in a depot yard or at a rest area. */
  get atWorkshop(): boolean {
    return this.driving.servicePoint !== null;
  }

  /** Repairs the truck completely at a depot or rest area, paying for it. */
  repair(): Result<Credits, RepairError> {
    if (this.currentDamage <= 0) {
      return err('notDamaged');
    }
    if (!this.atWorkshop) {
      return err('notAtServicePoint');
    }
    const cost = this.repairCost;
    const paid = this.economy.spend(cost, 'repair');
    if (!paid.ok) {
      return err(paid.error);
    }
    this.currentDamage = 0;
    this.applyPerformance();
    this.logger.info(`Repaired for ${cost}.`);
    this.events.emit('VehicleRepaired', { cost });
    return ok(cost);
  }

  dispose(): void {
    this.unsubscribe();
  }

  private onCollision(impactSpeedMetersPerSecond: number): void {
    const before = this.currentDamage;
    this.currentDamage = Math.min(1, before + truckDamageFromImpact(impactSpeedMetersPerSecond));
    const addedDamage = this.currentDamage - before;
    if (addedDamage <= 0) {
      return;
    }
    this.applyPerformance();
    this.events.emit('VehicleDamaged', { damage: this.currentDamage, addedDamage, band: this.band });
  }

  private applyPerformance(): void {
    this.driving.setPerformanceModifier('damage', damagePerformance(this.currentDamage));
  }
}
