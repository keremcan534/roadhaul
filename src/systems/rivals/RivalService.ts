import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { SeededRandom } from '../../core/random/SeededRandom';
import { err, ok, type Result } from '../../core/Result';
import type { Clock } from '../../core/time/Clock';
import type { GameConfig } from '../../data/config/GameConfig';
import type { ContentCatalog } from '../../data/ContentCatalog';
import { vehicleCanHaul, type MissionDefinition } from '../../data/definitions/MissionDefinition';
import { PLAYER_COMPANY_ID, type RivalCompanyDefinition } from '../../data/definitions/RivalCompanyDefinition';
import type { VehicleDefinition } from '../../data/definitions/VehicleDefinition';
import type { Credits, Fraction } from '../../data/units';
import type { SpendError } from '../../domain/economy/CurrencyWallet';
import { fleetJobProfit, fleetJobSeed, planFleetJob, type FleetDriver, type FleetJob, type FleetJobRules } from '../../domain/fleet/fleetJobs';
import { campaignTarget, nextLeader, rivalDestination } from '../../domain/rivals/rivalMoves';
import { StandingBoard } from '../../domain/rivals/StandingBoard';
import { planTender, type Tender, type TenderRules } from '../../domain/rivals/tenders';
import type { RivalCompanySaveData, RivalsSaveData } from '../../domain/save/SaveGameData';
import type { EconomyService } from '../economy/EconomyService';
import { placeOnJob, type DepotRoads, type JobRoute, type MapPlacement } from '../fleet/DepotRoads';
import type { GameEvents } from '../GameEvents';
import type { CompanyLevelSource, MissionService } from '../missions/MissionService';
import type { GarageService } from '../vehicles/GarageService';
import type { TenderBoard } from './TenderBoard';

export type CampaignError = 'unknownCity' | 'coolingDown' | SpendError;
export type AcquireRivalError = 'unknownRival' | 'acquired' | 'tooStrong' | SpendError;

/** A company in the league: the player's or a rival still in business. */
export interface LeagueEntry {
  /** PLAYER_COMPANY_ID or a rival's id. */
  readonly companyId: string;
  /** What it is worth: its money and its trucks at their price. */
  readonly value: Credits;
  readonly trucks: number;
  /** How many cities it leads. */
  readonly cities: number;
}

/** A rival as the HQ shows it. */
export interface RivalStatus {
  readonly definition: RivalCompanyDefinition;
  readonly credits: Credits;
  readonly trucks: number;
  readonly value: Credits;
  readonly cities: number;
  /** Bought out by the company: gone for good. */
  readonly acquired: boolean;
  /** What buying it out costs now. */
  readonly price: Credits;
  /** The company is worth more than it: it can be bought out. */
  readonly withinReach: boolean;
}

/** One company's share of a city. */
export interface CompanyShare {
  readonly companyId: string;
  readonly share: Fraction;
}

/** How a city stands, as the HQ shows it. */
export interface CityStatus {
  readonly cityId: string;
  /** The company's share first, then each rival's still in business. */
  readonly shares: readonly CompanyShare[];
  /** Null while it is contested. */
  readonly leaderId: string | null;
  /** Seconds before the company can run its next campaign there; 0 when it can now. */
  readonly campaignSecondsLeft: number;
}

/** What happened in the market lately, for the HQ's news. */
export type MarketNews =
  | { readonly kind: 'leader'; readonly cityId: string; readonly companyId: string | null; readonly atMs: number }
  | { readonly kind: 'campaign'; readonly cityId: string; readonly companyId: string; readonly atMs: number }
  | { readonly kind: 'truck'; readonly companyId: string; readonly trucks: number; readonly atMs: number }
  | { readonly kind: 'tender'; readonly companyId: string; readonly won: boolean; readonly atMs: number }
  | { readonly kind: 'acquired'; readonly companyId: string; readonly atMs: number };

/** A rival's truck on the map (for the map and the minimap). */
export interface RivalMarker extends MapPlacement {
  rivalId: string;
  color: number;
  /** On the road, not standing at a depot. */
  moving: boolean;
  /** The truck racing the company for its tender. */
  racing: boolean;
}

/** The race for the tender the company took, as the HUD shows it. */
export interface TenderRaceStatus {
  readonly tender: Tender;
  /** The cargo is aboard: both trucks are on their way. */
  readonly started: boolean;
  /** How far the rival has got, 0..1. */
  readonly rivalProgress: Fraction;
  /** Seconds until the rival unloads; 0 once it has. */
  readonly rivalSecondsLeft: number;
}

/** A rival's truck. */
interface RivalTruck {
  cityId: string;
  job: FleetJob | null;
  elapsedSeconds: number;
  /** The job's way on the map, looked up when the map first shows it. */
  route: JobRoute | null;
}

/** A rival company. */
interface RivalState {
  readonly definition: RivalCompanyDefinition;
  readonly vehicle: VehicleDefinition;
  readonly driver: FleetDriver;
  credits: Credits;
  acquired: boolean;
  trucks: RivalTruck[];
  campaignCooldownSeconds: number;
  decisionSeconds: number;
}

/** The HQ's news keeps this many items. */
const NEWS_KEPT = 8;
/** A city changes hands only when the new leader is this much of the share ahead of the one before. */
const LEAD_MARGIN = 0.03;
/** The market moves at most this long at once, seconds: a longer update or catch-up is worked through in steps. */
const MAX_STEP_SECONDS = 10;
/** Buy-out prices are rounded to this many credits. */
const PRICE_ROUNDING = 100;

/**
 * The rival companies (spec §65 V3: tenders and an AI economy), and how
 * every company stands in each city (StandingBoard). Each rival runs trucks
 * that take contracts between the cities by themselves, as the company's
 * fleet does (planFleetJob): what they deliver wins them standing in both
 * cities and money, which buys them more trucks and campaigns; the more
 * aggressive ones send their trucks and campaigns into the cities the
 * player leads. The company wins standing with every delivery it drives
 * and every one its fleet makes, with campaigns (runCampaign) and with
 * tenders. Leading a city makes its contracts pay a bonus (paid on
 * MissionCompleted, after the delivery itself). Now and then a tender comes
 * to the job board (TenderBoard): a contract a rival races the company
 * for from the moment it is loaded, decided when it is delivered. A rival
 * the company has outgrown can be bought out (acquire). Emits
 * CityLeaderChanged, CampaignRun, RivalTruckBought, LeaderBonusPaid,
 * TenderPosted, TenderRivalArrived, TenderDecided and RivalAcquired.
 */
export class RivalService {
  private rivals: RivalState[];
  private readonly board: StandingBoard;
  /** The company's campaign timers, one per city of the board, seconds. */
  private readonly campaignCooldowns: Float64Array;
  /** Each city's leader (nextLeader): who holds it until clearly overtaken. */
  private readonly leaders: (string | null)[];
  private race: Tender | null = null;
  /** The race's way on the map, looked up when the map first shows it. */
  private raceRoute: JobRoute | null = null;
  /** The racing rival's run, as a contract for placeOnJob (reused). */
  private readonly raceJob = { durationSeconds: 1 };
  private raceArrived = false;
  private nextTenderSeconds = 0;
  private tendersPosted = 0;
  private jobsPlanned = 0;
  private away = false;
  /** A game is loaded (restore): until then the market stands still. */
  private loaded = false;
  private readonly recentNews: MarketNews[] = [];
  /** Reused markers, one per truck on the map, filled by updateMarkers(). */
  readonly markers: RivalMarker[] = [];
  private readonly jobRules: FleetJobRules;
  private readonly tenderRules: TenderRules;
  private readonly leaderOfCity = (cityId: string): string | null => this.leaderOf(cityId);
  private readonly unsubscribe: Unsubscribe[];

  constructor(
    private readonly content: ContentCatalog,
    private readonly roads: DepotRoads,
    private readonly tenders: TenderBoard,
    private readonly missions: MissionService,
    private readonly garage: GarageService,
    private readonly economy: EconomyService,
    private readonly company: CompanyLevelSource,
    private readonly clock: Clock,
    private readonly events: EventBus<GameEvents>,
    private readonly config: GameConfig['rivals'],
    private readonly fleetConfig: GameConfig['fleet'],
    economyConfig: GameConfig['economy'],
    fuelConfig: GameConfig['fuel'],
    loadingSeconds: number,
    private readonly logger: Logger,
  ) {
    this.board = new StandingBoard(
      content.cities.all.map((city) => city.id),
      [PLAYER_COMPANY_ID, ...content.rivals.all.map((rival) => rival.id)],
    );
    this.campaignCooldowns = new Float64Array(content.cities.size);
    this.leaders = content.cities.all.map(() => null);
    this.rivals = content.rivals.all.map((definition, index) => this.freshRival(definition, index));
    this.jobRules = {
      averageSpeedKmh: fleetConfig.averageSpeedKmh,
      handlingSeconds: fleetConfig.handlingSeconds,
      payFactor: config.payFactor,
      consumptionScale: fuelConfig.consumptionScale,
      fuelPricePerLiter: economyConfig.fuelPricePerLiter,
    };
    this.tenderRules = {
      prizeShare: config.tenderPrize,
      rivalSpeedKmh: config.tenderRivalSpeedKmh,
      unloadSeconds: loadingSeconds,
    };
    // Subscribed after the economy, the company and the events: a delivery is paid before its bonus.
    this.unsubscribe = [
      events.on('MissionStateChanged', ({ missionId, previous }) => {
        if (previous === null) {
          this.takeTender(missionId);
        }
      }),
      events.on('MissionCompleted', (delivery) => this.countDelivery(delivery)),
      events.on('MissionFailed', ({ missionId }) => this.decideRace(missionId, false)),
      events.on('FleetJobCompleted', ({ originCityId, destinationCityId, away }) =>
        this.win(PLAYER_COMPANY_ID, originCityId, destinationCityId, this.config.fleetJobPoints, away),
      ),
    ];
  }

  /** The rivals, in content order, bought out or not. */
  statuses(): RivalStatus[] {
    const playerValue = this.playerValue();
    return this.rivals.map((rival) => {
      const value = this.valueOf(rival);
      return {
        definition: rival.definition,
        credits: rival.credits,
        trucks: rival.trucks.length,
        value,
        cities: this.citiesLedBy(rival.definition.id),
        acquired: rival.acquired,
        price: this.priceOf(rival),
        withinReach: !rival.acquired && playerValue > value,
      };
    });
  }

  /** The company and the rivals still in business, the most valuable first. */
  league(): LeagueEntry[] {
    const entries: LeagueEntry[] = [
      {
        companyId: PLAYER_COMPANY_ID,
        value: this.playerValue(),
        trucks: this.garage.trucks.length,
        cities: this.citiesLedBy(PLAYER_COMPANY_ID),
      },
    ];
    for (const rival of this.rivals) {
      if (!rival.acquired) {
        entries.push({
          companyId: rival.definition.id,
          value: this.valueOf(rival),
          trucks: rival.trucks.length,
          cities: this.citiesLedBy(rival.definition.id),
        });
      }
    }
    return entries.sort((a, b) => b.value - a.value);
  }

  /** Every city with a depot on the map being driven (every city while nothing is), and how it stands. */
  cities(): CityStatus[] {
    const market = this.roads.market();
    const cityIds = market === null ? this.board.cityIds : market.cities.map((city) => city.id);
    return cityIds.map((cityId) => ({
      cityId,
      shares: [PLAYER_COMPANY_ID, ...this.rivals.filter((rival) => !rival.acquired).map((rival) => rival.definition.id)].map(
        (companyId) => ({ companyId, share: this.board.shareOf(cityId, companyId) }),
      ),
      leaderId: this.leaderOf(cityId),
      campaignSecondsLeft: this.campaignCooldowns[this.board.cityIds.indexOf(cityId)] ?? 0,
    }));
  }

  /** The company leading `cityId`, or null while it is contested. Allocation-free. */
  leaderOf(cityId: string): string | null {
    const index = this.board.cityIds.indexOf(cityId);
    return index < 0 ? null : this.leaders[index]!;
  }

  /** The rival companies of the content, in order: known before any game is loaded. */
  get definitions(): readonly RivalCompanyDefinition[] {
    return this.content.rivals.all;
  }

  /** `companyId`'s colour on the map; null for the player's company (the UI picks its own). */
  colorOf(companyId: string): number | null {
    return this.content.rivals.find(companyId)?.color ?? null;
  }

  /** The terms the HQ explains: the share a leader needs, the leader's bonus, what a campaign costs. */
  get terms(): { readonly leadShare: Fraction; readonly leaderBonus: Fraction; readonly campaignCost: Credits } {
    return this.config;
  }

  /** The newest first. */
  get news(): readonly MarketNews[] {
    return this.recentNews;
  }

  /** The tender on the job board, or null. */
  get tender(): Tender | null {
    return this.tenders.tender;
  }

  /** The tender behind `missionId` (on the board, or being raced), or null. */
  tenderFor(missionId: string): Tender | null {
    if (this.race?.contract.id === missionId) {
      return this.race;
    }
    const posted = this.tenders.tender;
    return posted?.contract.id === missionId ? posted : null;
  }

  /** The tender the company took and is racing its rival for, or null. Allocation-free. */
  get racing(): Tender | null {
    return this.race;
  }

  /** How long the race has run: the contract's delivery clock from loading on, 0 before. Allocation-free. */
  raceSeconds(): number {
    const race = this.race;
    const active = this.missions.active;
    if (race === null || active === null || active.missionId !== race.contract.id) {
      return 0;
    }
    return active.state === 'loaded' || active.state === 'delivering' ? active.deliverySeconds : 0;
  }

  /** The race for the tender the company took, or null. */
  raceStatus(): TenderRaceStatus | null {
    const race = this.race;
    const active = this.missions.active;
    if (race === null || active === null || active.missionId !== race.contract.id) {
      return null;
    }
    const started = active.state === 'loaded' || active.state === 'delivering';
    const elapsed = this.raceSeconds();
    return {
      tender: race,
      started,
      rivalProgress: Math.min(1, elapsed / race.rivalSeconds),
      rivalSecondsLeft: Math.max(0, race.rivalSeconds - elapsed),
    };
  }

  /**
   * Runs a campaign in `cityId` for GameConfig.rivals.campaignCost: the
   * company wins campaignPoints of standing there. Then not again there for
   * campaignCooldownSeconds.
   */
  runCampaign(cityId: string): Result<void, CampaignError> {
    const index = this.board.cityIds.indexOf(cityId);
    if (index < 0) {
      return err('unknownCity');
    }
    if (this.campaignCooldowns[index]! > 0) {
      return err('coolingDown');
    }
    const paid = this.economy.spend(this.config.campaignCost, 'campaign');
    if (!paid.ok) {
      return err(paid.error);
    }
    this.campaignCooldowns[index] = this.config.campaignCooldownSeconds;
    this.board.add(cityId, PLAYER_COMPANY_ID, this.config.campaignPoints);
    this.logger.info(`Campaign in ${cityId}.`);
    this.announceCampaign(PLAYER_COMPANY_ID, cityId, false);
    this.checkLeaders(false);
    return ok(undefined);
  }

  /**
   * Buys `rivalId` out, for its value times GameConfig.rivals.acquisitionPremium,
   * once the company is worth more than it: its trucks leave the roads, and
   * its standing in every city becomes the company's.
   */
  acquire(rivalId: string): Result<void, AcquireRivalError> {
    const rival = this.rivals.find((candidate) => candidate.definition.id === rivalId);
    if (rival === undefined) {
      return err('unknownRival');
    }
    if (rival.acquired) {
      return err('acquired');
    }
    if (this.playerValue() <= this.valueOf(rival)) {
      return err('tooStrong');
    }
    const price = this.priceOf(rival);
    const paid = this.economy.spend(price, 'buyout');
    if (!paid.ok) {
      return err(paid.error);
    }
    rival.acquired = true;
    rival.trucks = [];
    rival.credits = 0;
    this.board.transfer(rivalId, PLAYER_COMPANY_ID);
    if (this.tenders.tender?.rivalId === rivalId) {
      this.tenders.post(null);
    }
    if (this.race?.rivalId === rivalId) {
      this.race = null; // The contract goes on, without a race.
    }
    this.logger.info(`Bought ${rivalId} out for ${price}.`);
    this.addNews({ kind: 'acquired', companyId: rivalId, atMs: this.clock.now() });
    this.events.emit('RivalAcquired', { rivalId, price });
    this.checkLeaders(false);
    return ok(undefined);
  }

  /** The market moves on for `dt` seconds of game time: call every fixed step while the game runs. Nothing before a game is loaded. */
  update(dt: number): void {
    if (!(dt > 0) || !this.loaded) {
      return;
    }
    this.run(dt);
    const race = this.race;
    if (race !== null && !this.raceArrived) {
      const active = this.missions.active;
      if (active !== null && active.missionId === race.contract.id && active.deliverySeconds >= race.rivalSeconds) {
        this.raceArrived = true;
        this.events.emit('TenderRivalArrived', { missionId: race.contract.id, rivalId: race.rivalId });
      }
    }
  }

  /**
   * The rivals work through `seconds` the game was closed (at most
   * GameConfig.fleet.awayHours, as the fleet does): their trucks deliver,
   * standing wears, they buy trucks and run campaigns. What changes is
   * announced as `away`.
   */
  catchUp(seconds: number): void {
    const away = Math.min(Math.max(0, seconds), this.fleetConfig.awayHours * 3600);
    if (!(away > 0) || !this.loaded) {
      return;
    }
    this.away = true;
    try {
      this.run(away);
    } finally {
      this.away = false;
    }
  }

  /**
   * Fills `markers` with where each rival truck on a contract is, and the
   * one racing the company, and returns how many. Allocation-free once
   * every truck has a marker and its way.
   */
  updateMarkers(): number {
    let count = 0;
    for (let r = 0; r < this.rivals.length; r++) {
      const rival = this.rivals[r]!;
      for (let t = 0; t < rival.trucks.length; t++) {
        const truck = rival.trucks[t]!;
        const job = truck.job;
        if (job === null) {
          continue;
        }
        const route = truck.route ?? (truck.route = this.roads.route(job.originCityId, job.destinationCityId));
        if (route === null) {
          continue;
        }
        const marker = this.markerAt(count++, rival.definition, false);
        marker.moving = placeOnJob(route, job, truck.elapsedSeconds, this.jobRules.handlingSeconds, marker);
      }
    }
    const race = this.race;
    if (race !== null && this.missions.active?.missionId === race.contract.id) {
      const route = this.raceRoute ?? (this.raceRoute = this.roads.route(race.contract.originCityId, race.contract.destinationCityId));
      const rival = this.content.rivals.find(race.rivalId);
      if (route !== null && rival !== undefined) {
        const marker = this.markerAt(count++, rival, true);
        this.raceJob.durationSeconds = race.rivalSeconds;
        const elapsed = Math.min(race.rivalSeconds, this.raceSeconds());
        marker.moving = placeOnJob(route, this.raceJob, elapsed, 2 * this.tenderRules.unloadSeconds, marker);
      }
    }
    return count;
  }

  /** Takes over the rivals of a loaded or new game (after the contract under way). */
  restore(saved: RivalsSaveData): void {
    this.board.clear();
    for (const entry of saved.standing) {
      if (this.board.hasCity(entry.cityId) && this.board.companyIds.includes(entry.companyId)) {
        this.board.set(entry.cityId, entry.companyId, entry.points);
      }
    }
    this.rivals = this.content.rivals.all.map((definition, index) => {
      const kept = saved.companies.find((company) => company.rivalId === definition.id);
      if (kept !== undefined) {
        return this.fromSave(definition, kept);
      }
      const fresh = this.freshRival(definition, index);
      this.board.add(definition.homeCityId, definition.id, this.config.startingHomePoints);
      return fresh;
    });
    this.campaignCooldowns.fill(0);
    for (const cooldown of saved.campaignCooldowns) {
      const index = this.board.cityIds.indexOf(cooldown.cityId);
      if (index >= 0) {
        this.campaignCooldowns[index] = cooldown.seconds;
      }
    }
    this.tenders.post(saved.tender === null ? null : { ...saved.tender });
    const active = this.missions.active;
    this.race = saved.race !== null && active !== null && active.missionId === saved.race.contract.id ? { ...saved.race } : null;
    this.raceRoute = null;
    this.raceArrived = this.race !== null && active !== null && active.deliverySeconds >= this.race.rivalSeconds;
    this.nextTenderSeconds = saved.nextTenderSeconds ?? this.config.firstTenderSeconds;
    this.tendersPosted = saved.tendersPosted;
    this.jobsPlanned = saved.jobsPlanned;
    this.recentNews.length = 0;
    this.board.cityIds.forEach((cityId, index) => {
      this.leaders[index] = this.board.leaderOf(cityId, this.config.leadShare);
    });
    this.loaded = true;
  }

  snapshot(): RivalsSaveData {
    return {
      companies: this.rivals.map((rival) => ({
        rivalId: rival.definition.id,
        credits: rival.credits,
        acquired: rival.acquired,
        trucks: rival.trucks.map((truck) => ({
          cityId: truck.cityId,
          job: truck.job === null ? null : { ...truck.job, elapsedSeconds: truck.elapsedSeconds },
        })),
        campaignCooldownSeconds: rival.campaignCooldownSeconds,
        decisionSeconds: rival.decisionSeconds,
      })),
      standing: this.board.entries(),
      campaignCooldowns: this.board.cityIds
        .map((cityId, index) => ({ cityId, seconds: this.campaignCooldowns[index]! }))
        .filter((cooldown) => cooldown.seconds > 0),
      tender: this.tenders.tender,
      race: this.race,
      nextTenderSeconds: this.nextTenderSeconds,
      tendersPosted: this.tendersPosted,
      jobsPlanned: this.jobsPlanned,
    };
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribe) {
      unsubscribe();
    }
  }

  /**
   * Works through `seconds` at most MAX_STEP_SECONDS at a time, so a long
   * update (the debug fast-forward) or catch-up runs every timer as the
   * fixed steps would. Allocation-free for a fixed step.
   */
  private run(seconds: number): void {
    let left = seconds;
    while (left > 1e-9) {
      const step = Math.min(MAX_STEP_SECONDS, left);
      this.advance(step);
      left -= step;
    }
  }

  /** Everything that moves with time: standing wears, trucks drive, timers run, rivals think. */
  private advance(seconds: number): void {
    this.board.wear(seconds, this.config.pointsHalfLifeSeconds);
    for (let i = 0; i < this.campaignCooldowns.length; i++) {
      this.campaignCooldowns[i] = Math.max(0, this.campaignCooldowns[i]! - seconds);
    }
    for (let r = 0; r < this.rivals.length; r++) {
      const rival = this.rivals[r]!;
      if (rival.acquired) {
        continue;
      }
      for (let t = 0; t < rival.trucks.length; t++) {
        this.advanceTruck(rival, rival.trucks[t]!, seconds);
      }
      rival.campaignCooldownSeconds = Math.max(0, rival.campaignCooldownSeconds - seconds);
      // Never below zero when the step ends: the save takes no timer that ran out.
      rival.decisionSeconds -= seconds;
      while (rival.decisionSeconds <= 0) {
        rival.decisionSeconds += this.config.decisionSeconds;
        this.decide(rival, r);
      }
    }
    // Held at zero until a tender can be put up (a map is being driven).
    this.nextTenderSeconds = Math.max(0, this.nextTenderSeconds - seconds);
    if (this.nextTenderSeconds === 0) {
      this.postTender();
    }
  }

  /** Works `truck` through `seconds`: the contract under way, and the next ones. */
  private advanceTruck(rival: RivalState, truck: RivalTruck, seconds: number): void {
    let left = seconds;
    while (left > 1e-9) {
      const job = truck.job ?? this.startJob(rival, truck);
      if (job === null) {
        return; // Nowhere to go on this map, or no map.
      }
      const used = Math.min(left, job.durationSeconds - truck.elapsedSeconds);
      truck.elapsedSeconds += used;
      left -= used;
      if (truck.elapsedSeconds >= job.durationSeconds - 1e-9) {
        this.finishJob(rival, truck, job);
      }
    }
  }

  /** Plans `truck`'s next contract (rare: once a contract, so it may allocate). */
  private startJob(rival: RivalState, truck: RivalTruck): FleetJob | null {
    const market = this.roads.market();
    if (market === null) {
      return null;
    }
    const seed = fleetJobSeed(this.jobsPlanned) ^ 0x5bd1e995;
    const toCityId = rivalDestination({
      cityIds: market.cities.map((city) => city.id),
      fromCityId: truck.cityId,
      homeCityId: rival.definition.homeCityId,
      playerCities: this.board.cityIds.filter((cityId) => this.leaderOf(cityId) === PLAYER_COMPANY_ID),
      aggression: rival.definition.aggression,
      random: new SeededRandom(seed),
    });
    const job = planFleetJob({
      market,
      fromCityId: truck.cityId,
      ...(toCityId === null ? {} : { toCityId }),
      truck: rival.vehicle,
      truckDamage: 0,
      driver: rival.driver,
      rules: this.jobRules,
      seed,
    });
    if (job === null) {
      return null;
    }
    this.jobsPlanned++;
    truck.job = job;
    truck.elapsedSeconds = 0;
    truck.route = null;
    return job;
  }

  /** Delivers `job`: the rival is paid (more from a city it leads) and wins standing in both cities. */
  private finishJob(rival: RivalState, truck: RivalTruck, job: FleetJob): void {
    let profit = fleetJobProfit(job);
    if (this.leaderOf(job.originCityId) === rival.definition.id) {
      profit += Math.round(job.pay * this.config.leaderBonus);
    }
    rival.credits = Math.max(0, rival.credits + profit);
    truck.cityId = job.destinationCityId;
    truck.job = null;
    truck.route = null;
    truck.elapsedSeconds = 0;
    this.win(rival.definition.id, job.originCityId, job.destinationCityId, this.config.fleetJobPoints, this.away);
  }

  /**
   * A rival thinks over its moves: another truck when it can afford one;
   * else perhaps a campaign, the likelier the more aggressive it is. To
   * keep a slipping lead or to take a city from the player it spends what
   * it has; to win ground elsewhere, only what it is not saving for its
   * next truck.
   */
  private decide(rival: RivalState, index: number): void {
    const definition = rival.definition;
    const reserve = this.config.reserveCredits;
    const growing = rival.trucks.length < definition.maxTrucks;
    if (growing && rival.credits >= rival.vehicle.purchasePrice + reserve) {
      rival.credits -= rival.vehicle.purchasePrice;
      rival.trucks.push({ cityId: definition.homeCityId, job: null, elapsedSeconds: 0, route: null });
      this.logger.info(`${definition.id} bought a truck (${rival.trucks.length}).`);
      this.addNews({ kind: 'truck', companyId: definition.id, trucks: rival.trucks.length, atMs: this.clock.now() });
      this.events.emit('RivalTruckBought', { rivalId: definition.id, trucks: rival.trucks.length, away: this.away });
      return;
    }
    if (rival.campaignCooldownSeconds > 0 || rival.credits < this.config.campaignCost + reserve) {
      return;
    }
    const target = campaignTarget(this.board, this.leaderOfCity, definition.id, definition.homeCityId, PLAYER_COMPANY_ID);
    if (target === null) {
      return;
    }
    const saving = target.aim === 'expand' && growing ? rival.vehicle.purchasePrice : 0;
    if (rival.credits < this.config.campaignCost + reserve + saving) {
      return;
    }
    const roll = new SeededRandom(Math.imul(this.jobsPlanned + 1, 0x27d4eb2f) ^ Math.imul(index + 1, 0x165667b1)).next();
    if (roll >= definition.aggression) {
      return;
    }
    const cityId = target.cityId;
    rival.credits -= this.config.campaignCost;
    rival.campaignCooldownSeconds = this.config.campaignCooldownSeconds;
    this.board.add(cityId, definition.id, this.config.campaignPoints);
    this.logger.info(`${definition.id} ran a campaign in ${cityId}.`);
    this.announceCampaign(definition.id, cityId, this.away);
    this.checkLeaders(this.away);
  }

  /** Puts the next tender up on the job board, in place of the one there. Waits for a map to plan it on. */
  private postTender(): void {
    const market = this.roads.market();
    if (market === null) {
      return;
    }
    this.nextTenderSeconds = this.config.tenderEverySeconds;
    const active = this.garage.activeTruck.definition;
    const tender = planTender({
      market: { ...market, vehicles: this.content.vehicles.all },
      number: this.tendersPosted,
      rivals: this.rivals.filter((rival) => !rival.acquired).map((rival) => rival.definition),
      rules: this.tenderRules,
      canTake: (contract: MissionDefinition) =>
        (contract.requiredCompanyLevel ?? 1) <= this.company.level &&
        vehicleCanHaul(active, contract, this.content.cargo.get(contract.cargoId)),
    });
    this.tenders.post(tender);
    if (tender === null) {
      return;
    }
    this.tendersPosted++;
    this.logger.info(`Tender ${tender.contract.id} against ${tender.rivalId}.`);
    if (!this.away) {
      this.events.emit('TenderPosted', { missionId: tender.contract.id, rivalId: tender.rivalId, prize: tender.prize });
    }
  }

  /** The company took the tender on the board: the race is on (from loading). */
  private takeTender(missionId: string): void {
    const posted = this.tenders.tender;
    if (posted === null || posted.contract.id !== missionId) {
      return;
    }
    this.race = posted;
    this.raceRoute = null;
    this.raceArrived = false;
    this.tenders.post(null);
  }

  /** A delivery: the leader's bonus when it came from a city the company leads, standing, and a race decided. */
  private countDelivery(delivery: GameEvents['MissionCompleted']): void {
    const { mission, missionId } = delivery;
    if (this.leaderOf(mission.originCityId) === PLAYER_COMPANY_ID) {
      const bonus = Math.round(delivery.reward.total * this.config.leaderBonus);
      if (bonus > 0) {
        this.economy.earn(bonus, 'leaderBonus');
        this.events.emit('LeaderBonusPaid', { missionId, cityId: mission.originCityId, bonus });
      }
    }
    this.win(PLAYER_COMPANY_ID, mission.originCityId, mission.destinationCityId, this.config.deliveryPoints, false);
    const race = this.race;
    if (race !== null && race.contract.id === missionId) {
      this.decideRace(missionId, delivery.deliverySeconds <= race.rivalSeconds);
    }
  }

  /** The race for `missionId` is over: the winner takes the prize and the standing. */
  private decideRace(missionId: string, won: boolean): void {
    const race = this.race;
    if (race === null || race.contract.id !== missionId) {
      return;
    }
    this.race = null;
    this.raceRoute = null;
    const { originCityId, destinationCityId } = race.contract;
    if (won) {
      this.economy.earn(race.prize, 'tender');
    } else {
      const rival = this.rivals.find((candidate) => candidate.definition.id === race.rivalId);
      if (rival !== undefined) {
        rival.credits += race.prize;
      }
    }
    this.logger.info(`Tender ${missionId} ${won ? 'won' : 'lost'} against ${race.rivalId}.`);
    this.addNews({ kind: 'tender', companyId: race.rivalId, won, atMs: this.clock.now() });
    this.events.emit('TenderDecided', { missionId, rivalId: race.rivalId, won, prize: race.prize });
    this.win(won ? PLAYER_COMPANY_ID : race.rivalId, originCityId, destinationCityId, this.config.tenderPoints, false);
  }

  /** `companyId` wins `points` of standing in both cities of a delivery. */
  private win(companyId: string, originCityId: string, destinationCityId: string, points: number, away: boolean): void {
    for (const cityId of [originCityId, destinationCityId]) {
      if (this.board.hasCity(cityId)) {
        this.board.add(cityId, companyId, points);
      }
    }
    this.checkLeaders(away);
  }

  /** Hands each city whose standing has shifted enough to its new leader, and announces it. */
  private checkLeaders(away: boolean): void {
    const cityIds = this.board.cityIds;
    for (let i = 0; i < cityIds.length; i++) {
      const cityId = cityIds[i]!;
      const previousId = this.leaders[i]!;
      const leaderId = nextLeader(this.board, cityId, previousId, this.config.leadShare, LEAD_MARGIN);
      if (leaderId !== previousId) {
        this.leaders[i] = leaderId;
        this.addNews({ kind: 'leader', cityId, companyId: leaderId, atMs: this.clock.now() });
        this.events.emit('CityLeaderChanged', { cityId, previousId, leaderId, away });
      }
    }
  }

  private announceCampaign(companyId: string, cityId: string, away: boolean): void {
    this.addNews({ kind: 'campaign', cityId, companyId, atMs: this.clock.now() });
    this.events.emit('CampaignRun', { companyId, cityId, away });
  }

  private addNews(item: MarketNews): void {
    this.recentNews.unshift(item);
    if (this.recentNews.length > NEWS_KEPT) {
      this.recentNews.length = NEWS_KEPT;
    }
  }

  private markerAt(index: number, rival: RivalCompanyDefinition, racing: boolean): RivalMarker {
    let marker = this.markers[index];
    if (marker === undefined) {
      marker = { rivalId: '', color: 0, x: 0, z: 0, heading: 0, moving: false, racing: false };
      this.markers.push(marker);
    }
    marker.rivalId = rival.id;
    marker.color = rival.color;
    marker.racing = racing;
    return marker;
  }

  /** The company's money and its trucks at their price. */
  private playerValue(): Credits {
    let value = this.economy.credits;
    for (const truck of this.garage.trucks) {
      value += truck.definition.purchasePrice;
    }
    return value;
  }

  private valueOf(rival: RivalState): Credits {
    return rival.acquired ? 0 : rival.credits + rival.trucks.length * rival.vehicle.purchasePrice;
  }

  private priceOf(rival: RivalState): Credits {
    return Math.round((this.valueOf(rival) * this.config.acquisitionPremium) / PRICE_ROUNDING) * PRICE_ROUNDING;
  }

  private citiesLedBy(companyId: string): number {
    let count = 0;
    for (const cityId of this.board.cityIds) {
      if (this.leaderOf(cityId) === companyId) {
        count++;
      }
    }
    return count;
  }

  /** A rival as a new game finds it: its money, and its trucks waiting at home. Its decisions are spread out. */
  private freshRival(definition: RivalCompanyDefinition, index: number): RivalState {
    return {
      definition,
      vehicle: this.content.vehicles.get(definition.vehicleId),
      driver: this.driverOf(definition),
      credits: definition.startingCredits,
      acquired: false,
      trucks: Array.from({ length: definition.startingTrucks }, () => ({
        cityId: definition.homeCityId,
        job: null,
        elapsedSeconds: 0,
        route: null,
      })),
      campaignCooldownSeconds: this.config.campaignCooldownSeconds,
      decisionSeconds: (this.config.decisionSeconds * (index + 1)) / Math.max(1, this.content.rivals.size),
    };
  }

  private fromSave(definition: RivalCompanyDefinition, saved: RivalCompanySaveData): RivalState {
    return {
      definition,
      vehicle: this.content.vehicles.get(definition.vehicleId),
      driver: this.driverOf(definition),
      credits: saved.credits,
      acquired: saved.acquired,
      trucks: saved.trucks.map((truck) => {
        const { elapsedSeconds, ...job } = truck.job ?? { elapsedSeconds: 0 };
        return { cityId: truck.cityId, job: truck.job === null ? null : (job as FleetJob), elapsedSeconds, route: null };
      }),
      campaignCooldownSeconds: saved.campaignCooldownSeconds,
      decisionSeconds: saved.decisionSeconds,
    };
  }

  /** A rival's drivers: its pace, never an incident (its workshop is its own business), and the usual wage. */
  private driverOf(definition: RivalCompanyDefinition): FleetDriver {
    return { speedFactor: definition.speedFactor, incidentChance: 0, payShare: this.config.driverPayShare };
  }
}
