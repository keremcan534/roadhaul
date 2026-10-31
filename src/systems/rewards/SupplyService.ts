import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { GameConfig } from '../../data/config/GameConfig';
import { BOOSTER_KINDS, isBoosterKind, type BoosterKind } from '../../data/definitions/BoosterKind';
import type { Credits } from '../../data/units';
import type { SuppliesSaveData } from '../../domain/save/SaveGameData';
import type { EconomyService } from '../economy/EconomyService';
import type { GameEvents } from '../GameEvents';
import type { DamageService, RepairError } from '../vehicles/DamageService';
import type { FuelService, RefuelError, Refuelled } from '../vehicles/FuelService';

/** The boosters the player starts: they run over the next few deliveries. */
export type RunningBooster = 'pay_boost' | 'xp_boost';

export type StartBoosterError = 'none' | 'running';
export type RefuelTokenError = 'none' | RefuelError;
export type RepairTokenError = 'none' | RepairError;

/** What the boosters running did for the delivery just made, for its result. */
export interface BoostedDelivery {
  /** Credits the pay boost added: 0 when it was not running. */
  readonly pay: Credits;
  /** Experience the experience boost added: 0 when it was not running. */
  readonly xp: number;
}

/** Gives XP: CompanyService. */
export interface ExperienceAwarder {
  award(xp: number): void;
}

/** Spends upgrade parts: UpgradeService asks how many there are and uses them. */
export interface PartsSource {
  readonly parts: number;
  useParts(count: number): void;
}

const NOTHING_BOOSTED: BoostedDelivery = Object.freeze({ pay: 0, xp: 0 });

/**
 * What crates give besides credits and looks (GameConfig.crates): upgrade
 * parts, which take credits off an upgrade's price (UpgradeService), and
 * boosters, kept until the player uses them: the pay boost (more pay on the
 * next few deliveries) and the experience boost (twice the experience) run
 * once started; a free fill-up or repair token is used at a pump or a
 * workshop. Earned only, never sold. All of it is in the save.
 *
 * It subscribes to MissionCompleted at boot, after CompanyService (the
 * delivery's own experience first) and before the UI: the result reads
 * `lastDelivery` already updated.
 */
export class SupplyService implements PartsSource {
  private partsHeld = 0;
  private readonly held: Record<BoosterKind, number> = { pay_boost: 0, xp_boost: 0, free_refuel: 0, free_repair: 0 };
  private payLeft = 0;
  private xpLeft = 0;
  private last: BoostedDelivery = NOTHING_BOOSTED;
  private readonly unsubscribe: Unsubscribe;

  constructor(
    private readonly config: GameConfig['crates']['boosters'],
    private readonly economy: EconomyService,
    private readonly company: ExperienceAwarder,
    private readonly fuel: FuelService,
    private readonly damage: DamageService,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {
    this.unsubscribe = events.on('MissionCompleted', ({ reward, xp }) => this.delivered(reward.total, xp));
  }

  get parts(): number {
    return this.partsHeld;
  }

  /** Boosters of `kind` held. */
  count(kind: BoosterKind): number {
    return this.held[kind];
  }

  /** Deliveries left on the pay boost and the experience boost running; 0 for none. */
  get payBoostLeft(): number {
    return this.payLeft;
  }

  get xpBoostLeft(): number {
    return this.xpLeft;
  }

  /** What the boosters running did for the delivery just made. */
  get lastDelivery(): BoostedDelivery {
    return this.last;
  }

  /** Parts and a booster a crate gave. */
  add(parts: number, booster: BoosterKind | null): void {
    this.partsHeld += Math.max(0, Math.floor(parts));
    if (booster !== null) {
      this.held[booster] += 1;
    }
    this.changed();
  }

  /** Uses `count` parts (UpgradeService, as it fits an upgrade for less). */
  useParts(count: number): void {
    this.partsHeld = Math.max(0, this.partsHeld - Math.max(0, Math.floor(count)));
    this.changed();
  }

  /** Starts a pay or experience boost held: it runs over the next few deliveries. */
  start(kind: RunningBooster): Result<number, StartBoosterError> {
    if (this.held[kind] <= 0) {
      return err('none');
    }
    if ((kind === 'pay_boost' ? this.payLeft : this.xpLeft) > 0) {
      return err('running');
    }
    this.held[kind] -= 1;
    if (kind === 'pay_boost') {
      this.payLeft = this.config.payDeliveries;
    } else {
      this.xpLeft = this.config.xpDeliveries;
    }
    this.logger.info(`Booster started: ${kind}.`);
    this.changed();
    return ok(kind === 'pay_boost' ? this.payLeft : this.xpLeft);
  }

  /** Fills the tank at a pump for nothing, with a token. */
  useFreeRefuel(): Result<Refuelled, RefuelTokenError> {
    if (this.held.free_refuel <= 0) {
      return err('none');
    }
    const filled = this.fuel.refuel(false, 0);
    if (!filled.ok) {
      return filled;
    }
    this.held.free_refuel -= 1;
    this.changed();
    return filled;
  }

  /** Repairs the truck at a workshop for nothing, with a token. */
  useFreeRepair(): Result<Credits, RepairTokenError> {
    if (this.held.free_repair <= 0) {
      return err('none');
    }
    const repaired = this.damage.repair(0);
    if (!repaired.ok) {
      return repaired;
    }
    this.held.free_repair -= 1;
    this.changed();
    return repaired;
  }

  snapshot(): SuppliesSaveData {
    const boosters: Record<string, number> = {};
    for (const kind of BOOSTER_KINDS) {
      if (this.held[kind] > 0) {
        boosters[kind] = this.held[kind];
      }
    }
    return { parts: this.partsHeld, boosters, payBoostLeft: this.payLeft, xpBoostLeft: this.xpLeft };
  }

  restore(save: SuppliesSaveData): void {
    this.partsHeld = save.parts;
    for (const kind of BOOSTER_KINDS) {
      this.held[kind] = 0;
    }
    for (const [kind, count] of Object.entries(save.boosters)) {
      if (isBoosterKind(kind)) {
        this.held[kind] = count;
      }
    }
    this.payLeft = save.payBoostLeft;
    this.xpLeft = save.xpBoostLeft;
    this.last = NOTHING_BOOSTED;
  }

  dispose(): void {
    this.unsubscribe();
  }

  private delivered(pay: Credits, xp: number): void {
    let added: Credits = 0;
    let moreXp = 0;
    if (this.payLeft > 0) {
      this.payLeft -= 1;
      added = Math.round(pay * this.config.payShare);
      if (added > 0) {
        this.economy.earn(added, 'booster');
      }
    }
    if (this.xpLeft > 0) {
      this.xpLeft -= 1;
      moreXp = xp;
      if (moreXp > 0) {
        this.company.award(moreXp);
      }
    }
    this.last = added === 0 && moreXp === 0 ? NOTHING_BOOSTED : { pay: added, xp: moreXp };
    if (added > 0 || moreXp > 0) {
      this.changed();
    }
  }

  private changed(): void {
    this.events.emit('SuppliesChanged', { parts: this.partsHeld });
  }
}
