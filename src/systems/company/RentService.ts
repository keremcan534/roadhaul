import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { Clock } from '../../core/time/Clock';
import type { Credits } from '../../data/units';
import type { PerkSource } from '../../domain/company/facilities';
import { accruedRent, rentFullness } from '../../domain/company/rent';
import type { RentSaveData } from '../../domain/save/SaveGameData';
import type { EconomyService } from '../economy/EconomyService';
import type { GameEvents } from '../GameEvents';

export type CollectRentError = 'nothingToCollect';

/**
 * The warehouse's rent (the facility whose effect is `rentPerHour`): money
 * that comes without driving. It piles up in real time, while the player
 * drives, sits in the menus or has the game closed, up to `capHours` of it,
 * and the player collects it at the head office. A level built raises the
 * rate from then on (what piled up before is settled at the old rate).
 * Kept in the save, to the fraction of a credit.
 */
export class RentService {
  private storedCredits = 0;
  private sinceMs = 0;
  /** The rate the rent has grown at since `sinceMs`, credits an hour. */
  private rate: Credits = 0;

  constructor(
    private readonly perks: PerkSource,
    private readonly economy: EconomyService,
    private readonly clock: Clock,
    /** GameConfig.company.rentCapHours. */
    private readonly capHours: number,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {
    // A level built changes the rate: what piled up so far grew at the old one.
    events.on('FacilityBuilt', () => this.settle());
  }

  /** Credits an hour the warehouse brings now; 0 without one. */
  get ratePerHour(): Credits {
    return this.perks.perks.rentPerHour;
  }

  /** The most that may pile up before the player collects it. */
  get capacity(): Credits {
    return Math.round(this.ratePerHour * this.capHours);
  }

  /** Whole credits waiting now. */
  get waiting(): Credits {
    return Math.floor(this.accrued());
  }

  /** How full it is, 0..1. */
  get fullness(): number {
    return rentFullness(this.accrued(), this.ratePerHour, this.capHours);
  }

  /** Pays the whole credits waiting into the company's account (the fraction stays, growing on). */
  collect(): Result<Credits, CollectRentError> {
    this.settle();
    const credits = Math.floor(this.storedCredits);
    if (credits <= 0) {
      return err('nothingToCollect');
    }
    this.storedCredits -= credits;
    this.economy.earn(credits, 'rent');
    this.logger.info(`Collected ${credits} in rent.`);
    this.events.emit('RentCollected', { credits });
    return ok(credits);
  }

  /**
   * What the save keeps: what was settled, and since when it grows. The
   * rate since then is the warehouse's now (a level built settles first), so
   * nothing is lost, and the save stays the same while nothing happens.
   */
  snapshot(): RentSaveData {
    return { storedCredits: this.storedCredits, sinceMs: this.sinceMs };
  }

  /** Takes up a loaded or new game's rent, at the rate of the facilities restored before it. */
  restore(data: RentSaveData): void {
    this.storedCredits = Math.max(0, data.storedCredits);
    this.sinceMs = data.sinceMs;
    this.rate = this.ratePerHour;
  }

  private accrued(): number {
    return accruedRent({ storedCredits: this.storedCredits, sinceMs: this.sinceMs }, this.rate, this.clock.now(), this.capHours);
  }

  /** What piled up so far, at the rate it grew at, kept; the rent grows on from now at the current rate. */
  private settle(): void {
    this.storedCredits = this.accrued();
    this.sinceMs = this.clock.now();
    this.rate = this.ratePerHour;
  }
}
