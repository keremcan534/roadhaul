import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { GameConfig } from '../../data/config/GameConfig';
import type { Credits, Fraction } from '../../data/units';
import { fuelCost, repairCost } from '../../domain/economy/costs';
import { CurrencyWallet, type SpendError } from '../../domain/economy/CurrencyWallet';
import type { GameEvents } from '../GameEvents';

/** Why money moved: shown on the result screen and used by future statistics. */
export const MONEY_REASONS = [
  'delivery',
  'event',
  'fuel',
  'repair',
  'vehicle',
  'upgrade',
  'paint',
  'fleet',
  'hiring',
  'leaderBonus',
  'tender',
  'campaign',
  'buyout',
] as const;
export type MoneyReason = (typeof MONEY_REASONS)[number];

/**
 * The single owner of the company's money (spec §13, §51). Nothing else
 * changes credits: the UI asks here (spend, canAfford) and listens for
 * MoneyChanged. Delivery rewards arrive through MissionCompleted.
 */
export class EconomyService {
  private readonly wallet = new CurrencyWallet(0);
  private readonly unsubscribe: Unsubscribe;

  constructor(
    private readonly events: EventBus<GameEvents>,
    private readonly config: GameConfig['economy'],
    private readonly logger: Logger,
  ) {
    this.unsubscribe = events.on('MissionCompleted', ({ reward }) => this.earn(reward.total, 'delivery'));
  }

  get credits(): Credits {
    return this.wallet.balance;
  }

  canAfford(amount: Credits): boolean {
    return this.wallet.canAfford(amount);
  }

  /** Sets the balance of a loaded or new game. No event: nothing was earned or spent. */
  restore(credits: Credits): void {
    this.wallet.reset(credits);
  }

  earn(amount: Credits, reason: MoneyReason): void {
    if (amount === 0) {
      return;
    }
    this.wallet.add(amount);
    this.logger.info(`+${amount} (${reason}) = ${this.wallet.balance}`);
    this.events.emit('MoneyChanged', { balance: this.wallet.balance, change: amount, reason });
  }

  spend(amount: Credits, reason: MoneyReason): Result<Credits, SpendError> {
    const spent = this.wallet.spend(amount);
    if (!spent.ok) {
      return err(spent.error);
    }
    if (amount > 0) {
      this.logger.info(`-${amount} (${reason}) = ${this.wallet.balance}`);
      this.events.emit('MoneyChanged', { balance: this.wallet.balance, change: -amount, reason });
    }
    return ok(this.wallet.balance);
  }

  /** Price of `liters` of fuel, at the pump or brought out to the road. */
  fuelCost(liters: number, roadside = false): Credits {
    const price = this.config.fuelPricePerLiter * (roadside ? this.config.roadsideFuelPriceFactor : 1);
    return fuelCost(liters, price);
  }

  /** Litres a budget buys, at the pump or on the road (whole litres of change never exist: rounded down). */
  litersAffordable(budget: Credits, roadside = false): number {
    const price = this.config.fuelPricePerLiter * (roadside ? this.config.roadsideFuelPriceFactor : 1);
    return Math.max(0, Math.floor(budget / price));
  }

  repairCost(damage: Fraction): Credits {
    return repairCost(damage, this.config.fullRepairCost);
  }

  dispose(): void {
    this.unsubscribe();
  }
}
