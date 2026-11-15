import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { Clock } from '../../core/time/Clock';
import type { GameConfig } from '../../data/config/GameConfig';
import type { PlaceDefinition } from '../../data/definitions/MapDefinition';
import type { Credits, Fraction } from '../../data/units';
import { STOPPED_SPEED_METERS_PER_SECOND } from '../../domain/missions/loadingBay';
import { localDay } from '../../domain/rewards/dailyReward';
import type { PlacesSaveData } from '../../domain/save/SaveGameData';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';
import type { VehicleRuntimeState } from '../../domain/vehicles/VehicleRuntimeState';
import type { EconomyService } from '../economy/EconomyService';
import type { GameEvents } from '../GameEvents';

/** What PlaceService reads of the drive: the truck and the world it is in. */
export interface PlaceDriving {
  readonly isDriving: boolean;
  readonly vehicle: Readonly<VehicleRuntimeState>;
  readonly world: Pick<DrivingWorld, 'placeAt'>;
}

/** Where the experience goes. */
export interface PlaceCompany {
  award(xp: number): void;
}

/** Why the day's puzzle pays nothing. */
export type PuzzleRewardError = 'alreadySolved' | 'notToday';
/** Why a wash pays nothing. */
export type WashRewardError = 'alreadyWashed' | 'notClean';

/** A saved game without the places: none found, nothing done today. */
export const NO_PLACES: PlacesSaveData = { found: [], puzzleDay: null, washDay: null };

/**
 * The places to visit beside the roads (MapDefinition.places; the owner's
 * request). Each fixed step it notes the place the truck stands still on
 * (`current`); the first stop at each pays a finder's reward
 * (GameConfig.places, PlaceFound). The diner's Yard Jam of the day
 * (`puzzleDay`, the player's own day) pays once a day (PuzzleSolved), and a
 * truck wash scrubbed clean in time once a day (TruckWashed). What was found
 * and the days of the last puzzle and wash are saved (v26).
 *
 * Call update() every fixed step on the road. Allocation-free there.
 */
export class PlaceService {
  private currentPlace: PlaceDefinition | null = null;
  private readonly foundIds = new Set<string>();
  private puzzleSolvedDay: number | null = null;
  private washedDay: number | null = null;
  private raceDay: number | null = null;
  private racesOnRaceDay = 0;

  constructor(
    private readonly driving: PlaceDriving,
    private readonly economy: Pick<EconomyService, 'earn'>,
    private readonly company: PlaceCompany,
    private readonly config: GameConfig['places'],
    private readonly clock: Clock,
    private readonly localTimeOffsetMinutes: number,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {}

  /** The place the truck stands still on, or null. */
  get current(): PlaceDefinition | null {
    return this.currentPlace;
  }

  /** Whether the company has stopped at `placeId` before. */
  isFound(placeId: string): boolean {
    return this.foundIds.has(placeId);
  }

  /** How many places the company has found. */
  get foundCount(): number {
    return this.foundIds.size;
  }

  /** The day the diner's puzzle is dealt for (its seed): the player's day today. */
  get puzzleDay(): number {
    return this.today();
  }

  /** The day's puzzle has been solved (and paid) today. */
  get puzzleSolvedToday(): boolean {
    return this.puzzleSolvedDay === this.today();
  }

  /** The truck has been washed (and the tip paid) today. */
  get washedToday(): boolean {
    return this.washedDay === this.today();
  }

  /** Street races left today at the race clubs (GameConfig.places.racesPerDay). */
  get racesLeftToday(): number {
    const run = this.raceDay === this.today() ? this.racesOnRaceDay : 0;
    return Math.max(0, this.config.racesPerDay - run);
  }

  /** A race started at a race club: one of today's. */
  countRace(): void {
    const today = this.today();
    this.racesOnRaceDay = this.raceDay === today ? this.racesOnRaceDay + 1 : 1;
    this.raceDay = today;
  }

  /** Every fixed step: the place the truck stands still on, a new one found and paid for. */
  update(): void {
    const driving = this.driving;
    if (!driving.isDriving) {
      this.currentPlace = null;
      return;
    }
    const vehicle = driving.vehicle;
    const place = Math.abs(vehicle.speed) < STOPPED_SPEED_METERS_PER_SECOND ? driving.world.placeAt(vehicle.x, vehicle.z) : null;
    if (place !== null && place !== this.currentPlace && !this.foundIds.has(place.id)) {
      this.find(place);
    }
    this.currentPlace = place;
  }

  /**
   * The day's puzzle solved in `moves` (dealt for `day`): pays once a day. A
   * puzzle dealt before midnight and solved after is no longer the day's.
   */
  solvePuzzle(day: number, moves: number): Result<{ readonly credits: Credits; readonly xp: number }, PuzzleRewardError> {
    const today = this.today();
    if (day !== today) {
      return err('notToday');
    }
    if (this.puzzleSolvedDay === today) {
      return err('alreadySolved');
    }
    this.puzzleSolvedDay = today;
    const { puzzleCredits: credits, puzzleXp: xp } = this.config;
    this.economy.earn(credits, 'place');
    this.company.award(xp);
    this.logger.info(`Solved the day's Yard Jam in ${moves} moves: +${credits}.`);
    this.events.emit('PuzzleSolved', { day, moves, credits, xp });
    return ok({ credits, xp });
  }

  /** A wash ended with `cleanShare` of the dirt scrubbed off: clean enough pays the tip, once a day. */
  finishWash(cleanShare: Fraction): Result<Credits, WashRewardError> {
    if (cleanShare < this.config.washCleanShare) {
      return err('notClean');
    }
    const today = this.today();
    if (this.washedDay === today) {
      return err('alreadyWashed');
    }
    this.washedDay = today;
    const credits = this.config.washCredits;
    this.economy.earn(credits, 'place');
    this.events.emit('TruckWashed', { credits });
    return ok(credits);
  }

  snapshot(): PlacesSaveData {
    return {
      found: [...this.foundIds].sort(),
      puzzleDay: this.puzzleSolvedDay,
      washDay: this.washedDay,
      ...(this.raceDay === null ? {} : { raceDay: this.raceDay, racesToday: this.racesOnRaceDay }),
    };
  }

  restore(saved: PlacesSaveData): void {
    this.foundIds.clear();
    for (const id of saved.found) {
      this.foundIds.add(id);
    }
    this.puzzleSolvedDay = saved.puzzleDay;
    this.washedDay = saved.washDay;
    this.raceDay = saved.raceDay ?? null;
    this.racesOnRaceDay = saved.racesToday ?? 0;
    this.currentPlace = null;
  }

  private find(place: PlaceDefinition): void {
    this.foundIds.add(place.id);
    const { findCredits: credits, findXp: xp } = this.config;
    this.economy.earn(credits, 'place');
    this.company.award(xp);
    this.logger.info(`Found ${place.id}: +${credits}, +${xp} XP.`);
    this.events.emit('PlaceFound', { placeId: place.id, kind: place.kind, credits, xp });
  }

  private today(): number {
    return localDay(this.clock.now(), this.localTimeOffsetMinutes);
  }
}
