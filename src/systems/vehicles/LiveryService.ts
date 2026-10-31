import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { ProductId } from '../../data/config/products';
import type { LiveryDefinition } from '../../data/definitions/LiveryDefinition';
import type { SpendError } from '../../domain/economy/CurrencyWallet';
import type { LiveriesSaveData } from '../../domain/save/SaveGameData';
import { trailerText } from '../../domain/vehicles/trailerText';
import type { EconomyService } from '../economy/EconomyService';
import type { GameEvents } from '../GameEvents';
import type { CompanyLevelSource } from '../missions/MissionService';

/** How a design is got. */
export type LiveryWay = 'free' | 'credits' | 'crate' | 'pack';

/** A design in the garage: whether the company has it, and if not, how it is got. */
export interface LiveryOffer {
  readonly livery: LiveryDefinition;
  readonly way: LiveryWay;
  readonly owned: boolean;
  /** For credits: below its company level, not for sale yet. */
  readonly locked: boolean;
  /** A pack's design where the shop does not sell it (the web game): shown, but there is no way to it here. */
  readonly unavailable: boolean;
}

export type BuyLiveryError = 'unknownLivery' | 'owned' | 'locked' | 'notForSale' | SpendError;
export type ApplyLiveryError = 'unknownLivery' | 'unknownTruck' | 'notOwned' | 'alreadyWorn';
export type TrailerTextError = 'unchanged';

/** The crate designs given: CrateService. */
export interface CrateLiverySource {
  ownsCrateLivery(liveryId: string): boolean;
}

/** The packs bought, and whether the shop sells them here: MonetizationService. */
export interface LiveryPackSource {
  owns(id: ProductId): boolean;
  readonly storeEnabled: boolean;
}

/** The company's trucks, by instance id: GarageService. */
export interface TruckList {
  readonly trucks: readonly { readonly instanceId: string }[];
}

/**
 * The trucks' designs (LiveryDefinition) and the company's trailer text: a
 * design bought once with credits (from its company level), given by a
 * crate (CrateService) or come with a cosmetic pack (MonetizationService)
 * is the company's, worn by any of its trucks for free; every truck leaves
 * the dealer in the first (the classic). The text is the company's, on all
 * its trailers (trailerText); none keeps the RoadHaul lettering. Looks
 * only. What was bought, what each truck wears and the text are in the save.
 */
export class LiveryService {
  private bought = new Set<string>();
  private worn = new Map<string, string>();
  private text: string | null = null;

  constructor(
    private readonly content: ContentCatalog,
    private readonly economy: EconomyService,
    private readonly company: CompanyLevelSource,
    private readonly garage: TruckList,
    private readonly crates: CrateLiverySource,
    private readonly packs: LiveryPackSource,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {}

  /** Every design, in content order, with whether the company has it and how it is got. */
  offers(): readonly LiveryOffer[] {
    return this.content.liveries.all.map((livery) => this.offerOf(livery));
  }

  /** The design truck `instanceId` wears: its own, or the classic. */
  liveryOf(instanceId: string): LiveryDefinition {
    const id = this.worn.get(instanceId);
    return (id === undefined ? undefined : this.content.liveries.find(id)) ?? this.content.liveries.all[0]!;
  }

  /** The company's trailer text, or null for the RoadHaul lettering. */
  get trailerText(): string | null {
    return this.text;
  }

  /** Buys a design sold for credits, for every truck of the company. */
  buy(liveryId: string): Result<LiveryDefinition, BuyLiveryError> {
    const livery = this.content.liveries.find(liveryId);
    if (livery === undefined) {
      return err('unknownLivery');
    }
    const offer = this.offerOf(livery);
    if (offer.owned) {
      return err('owned');
    }
    if (offer.way !== 'credits') {
      return err('notForSale');
    }
    if (offer.locked) {
      return err('locked');
    }
    const paid = this.economy.spend(livery.price, 'livery');
    if (!paid.ok) {
      return err(paid.error);
    }
    this.bought.add(liveryId);
    this.logger.info(`Design ${liveryId} bought for ${livery.price}.`);
    this.events.emit('LiveryChanged', { instanceId: null, liveryId });
    return ok(livery);
  }

  /** Puts a design the company has on truck `instanceId`, for free. */
  apply(instanceId: string, liveryId: string): Result<LiveryDefinition, ApplyLiveryError> {
    const livery = this.content.liveries.find(liveryId);
    if (livery === undefined) {
      return err('unknownLivery');
    }
    if (!this.garage.trucks.some((truck) => truck.instanceId === instanceId)) {
      return err('unknownTruck');
    }
    if (!this.offerOf(livery).owned) {
      return err('notOwned');
    }
    if (this.liveryOf(instanceId).id === liveryId) {
      return err('alreadyWorn');
    }
    if (livery.id === this.content.liveries.all[0]!.id) {
      this.worn.delete(instanceId);
    } else {
      this.worn.set(instanceId, liveryId);
    }
    this.logger.info(`${instanceId} now wears ${liveryId}.`);
    this.events.emit('LiveryChanged', { instanceId, liveryId });
    return ok(livery);
  }

  /** Sets the company's trailer text (`raw` as typed, in the player's language, `locale`); empty brings RoadHaul back. */
  setTrailerText(raw: string, locale: string): Result<string | null, TrailerTextError> {
    const text = trailerText(raw, locale);
    if (text === this.text) {
      return err('unchanged');
    }
    this.text = text;
    this.events.emit('LiveryChanged', { instanceId: null, liveryId: null });
    return ok(text);
  }

  snapshot(): LiveriesSaveData {
    return { bought: [...this.bought], worn: Object.fromEntries(this.worn), text: this.text };
  }

  /** A design the content no longer has is dropped; so is a truck's the company no longer owns. */
  restore(save: LiveriesSaveData): void {
    this.bought = new Set(save.bought.filter((id) => this.content.liveries.has(id)));
    this.worn = new Map(Object.entries(save.worn).filter(([, id]) => this.content.liveries.has(id)));
    this.text = save.text;
  }

  private offerOf(livery: LiveryDefinition): LiveryOffer {
    const way: LiveryWay =
      livery.crate !== undefined ? 'crate' : livery.pack !== undefined ? 'pack' : livery.price > 0 ? 'credits' : 'free';
    const owned =
      way === 'free' ||
      (way === 'credits' && this.bought.has(livery.id)) ||
      (way === 'crate' && this.crates.ownsCrateLivery(livery.id)) ||
      (way === 'pack' && livery.pack !== undefined && this.packs.owns(livery.pack));
    return {
      livery,
      way,
      owned,
      locked: way === 'credits' && this.company.level < (livery.requiredCompanyLevel ?? 1),
      unavailable: way === 'pack' && !owned && !this.packs.storeEnabled,
    };
  }
}
