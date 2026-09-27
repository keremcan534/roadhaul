import type { Clock } from '../../core/time/Clock';
import type { GameConfig } from '../../data/config/GameConfig';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { MissionDefinition } from '../../data/definitions/MissionDefinition';
import { NO_PERK_SOURCE, type PerkSource } from '../../domain/company/facilities';
import { generateContracts, type ContractMarket } from '../../domain/missions/contractGenerator';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';
import { createRouteGuidance } from '../../domain/world/roadRoute';
import type { DrivingService } from '../driving/DrivingService';

const HOUR_MS = 60 * 60 * 1000;

/** Where the job board's generated contracts come from: MissionService asks for the ones on offer. */
export interface ContractSource {
  /** The contracts on offer now: the same array until a new batch replaces it. */
  current(): readonly MissionDefinition[];
}

/**
 * Contracts of the day (spec §28–29): every few hours of the clock
 * (GameConfig.missions.dailyContracts) the contract generator deals a new
 * batch for the map being driven, the same for everyone at the same time.
 * Batches are numbered by the clock, so `?date=` fixes them for tests.
 */
export class DailyContracts implements ContractSource {
  private batch = Number.NaN;
  private world: DrivingWorld | null = null;
  private count = Number.NaN;
  private contracts: readonly MissionDefinition[] = [];

  constructor(
    private readonly content: ContentCatalog,
    private readonly driving: DrivingService,
    private readonly clock: Clock,
    private readonly config: GameConfig['missions']['dailyContracts'],
    /** The company's facilities: a logistics office brings more contracts of the day. */
    private readonly perks: PerkSource = NO_PERK_SOURCE,
  ) {}

  current(): readonly MissionDefinition[] {
    if (!this.driving.isDriving) {
      return [];
    }
    const batch = this.batchAt(this.clock.now());
    const world = this.driving.world;
    // More contracts come on top of the same ones: the generator deals them in the same order.
    const count = this.config.count + this.perks.perks.extraContracts;
    if (batch !== this.batch || world !== this.world || count !== this.count) {
      this.batch = batch;
      this.world = world;
      this.count = count;
      this.contracts = generateContracts(this.marketOn(world), batch, count);
    }
    return this.contracts;
  }

  /** Every how many hours a new batch comes. */
  get refreshHours(): number {
    return this.config.refreshHours;
  }

  /** How long until the next batch replaces the current one, ms. */
  msUntilNextBatch(): number {
    const nowMs = this.clock.now();
    return (this.batchAt(nowMs) + 1) * this.config.refreshHours * HOUR_MS - nowMs;
  }

  private batchAt(nowMs: number): number {
    return Math.floor(nowMs / (this.config.refreshHours * HOUR_MS));
  }

  /** The cities with a depot on `world`, and the road between their bays. */
  private marketOn(world: DrivingWorld): ContractMarket {
    const route = createRouteGuidance();
    return {
      cities: this.content.cities.all.filter((city) => world.depotOf(city.id) !== undefined),
      cargo: this.content.cargo.all,
      vehicles: this.content.vehicles.all,
      distanceMeters: (originCityId, destinationCityId) => {
        const from = world.depotOf(originCityId)!.bay;
        const to = world.depotOf(destinationCityId)!.bay;
        return world.network.guide(from.x, from.z, to.x, to.z, route).distanceMeters;
      },
    };
  }
}
