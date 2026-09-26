import type { EventReward } from '../data/definitions/EventDefinition';
import type { MissionDefinition } from '../data/definitions/MissionDefinition';
import type { Credits, Fraction } from '../data/units';
import type { MissionFailureReason, MissionState } from '../domain/missions/MissionInstance';
import type { MissionReward } from '../domain/missions/missionReward';
import type { TutorialStep } from '../domain/tutorial/tutorialSteps';
import type { DamageBand } from '../domain/vehicles/vehicleDamage';
import type { MoneyReason } from './economy/EconomyService';
import type { GameState } from './gameState/GameState';

/**
 * Every event that crosses system boundaries, keyed by name (spec §57).
 * Systems emit them. Presentation and UI subscribe and never change game state
 * directly. Add new events here as systems arrive.
 */
export interface GameEvents {
  GameStateChanged: {
    readonly previous: GameState;
    readonly current: GameState;
  };
  /** The truck hit a tree, building or the map edge. DamageService and MissionService turn it into damage. */
  VehicleCollided: {
    /** Speed into the obstacle, m/s. */
    readonly impactSpeedMetersPerSecond: number;
  };
  /** The active mission moved to another stage, including accepting it (previous: null). */
  MissionStateChanged: {
    readonly missionId: string;
    readonly previous: MissionState | null;
    readonly current: MissionState;
  };
  /** A collision damaged the cargo on board. */
  CargoDamaged: {
    readonly missionId: string;
    /** Damage from this hit alone. */
    readonly addedDamage: Fraction;
    /** Total cargo damage now. */
    readonly cargoDamage: Fraction;
  };
  /** The cargo was unloaded at its destination. EconomyService pays the reward, CompanyService adds the XP and reputation. */
  MissionCompleted: {
    readonly missionId: string;
    /** The contract: one of the game's own, or a generated one. */
    readonly mission: MissionDefinition;
    readonly reward: MissionReward;
    readonly deliverySeconds: number;
    readonly cargoDamage: Fraction;
    readonly xp: number;
    readonly reputation: number;
  };
  MissionFailed: {
    readonly missionId: string;
    readonly mission: MissionDefinition;
    readonly reason: MissionFailureReason;
    readonly reputationLost: number;
  };
  /** The company's credits changed (spec §57 MoneyChangedEvent). */
  MoneyChanged: {
    readonly balance: Credits;
    /** Positive when earned, negative when spent. */
    readonly change: Credits;
    readonly reason: MoneyReason;
  };
  /** The tank level crossed a whole percent, the truck was refuelled, or the tank ran dry. */
  FuelChanged: {
    readonly liters: number;
    readonly fraction: Fraction;
  };
  /** A collision damaged the truck (spec §57 VehicleDamagedEvent). */
  VehicleDamaged: {
    readonly damage: Fraction;
    readonly addedDamage: Fraction;
    readonly band: DamageBand;
  };
  VehicleRepaired: {
    readonly cost: Credits;
  };
  /** The tank was filled (or given emergency fuel), and paid for. */
  Refuelled: {
    readonly liters: number;
    readonly cost: Credits;
  };
  /** The company bought a truck at the dealer. It waits in the garage. */
  VehiclePurchased: {
    readonly instanceId: string;
    readonly definitionId: string;
    readonly price: Credits;
  };
  /** The player now drives another of the company's trucks, standing where the last one stood. */
  ActiveVehicleChanged: {
    readonly instanceId: string;
    readonly definitionId: string;
  };
  /** A truck was painted; paintId null brought its factory colour back. */
  VehiclePainted: {
    readonly instanceId: string;
    readonly paintId: string | null;
    readonly price: Credits;
  };
  /** An upgrade level was fitted to the active truck (spec §16). */
  UpgradePurchased: {
    readonly instanceId: string;
    readonly upgradeId: string;
    readonly level: number;
    readonly cost: Credits;
  };
  /** XP or reputation changed. */
  CompanyProgressed: {
    readonly xp: number;
    readonly level: number;
    readonly reputation: number;
  };
  /** The company reached a new level (spec §57 CompanyLevelUpEvent). */
  CompanyLevelUp: {
    readonly level: number;
  };
  /**
   * A delivery counted toward a running event (spec §22): the bonus it paid,
   * the event's progress, and its reward when this delivery met the objective.
   */
  EventProgressed: {
    readonly eventId: string;
    readonly bonus: Credits;
    readonly progress: number;
    readonly target: number;
    /** Paid now, with this delivery; null when the objective is not met, or was met before. */
    readonly reward: EventReward | null;
  };
  /** The tutorial moved on (spec §41), or was skipped (step: done). */
  TutorialStepChanged: {
    readonly step: TutorialStep;
    readonly previous: TutorialStep;
  };
  /** The weather is turning (spec §38): from `previousId` to `weatherId`, over the transition. */
  WeatherChanged: {
    readonly weatherId: string;
    readonly previousId: string;
  };
  /** The company hired a driver for its fleet (spec §27), and paid their fee. */
  DriverHired: {
    readonly driverId: string;
    readonly fee: Credits;
  };
  /** A driver left the company; the truck they had is back in the garage. */
  DriverDismissed: {
    readonly driverId: string;
  };
  /** A hired driver took one of the company's trucks out on contracts, or brought it back to the garage (instanceId null). */
  FleetTruckAssigned: {
    readonly driverId: string;
    readonly instanceId: string | null;
  };
  /** A hired driver delivered a fleet contract; `profit` (its pay less their share and the fuel) went to the company. */
  FleetJobCompleted: {
    readonly driverId: string;
    readonly instanceId: string;
    readonly originCityId: string;
    readonly destinationCityId: string;
    readonly cargoId: string;
    readonly pay: Credits;
    readonly driverShare: Credits;
    readonly fuelCost: Credits;
    readonly profit: Credits;
    /** The truck came back damaged. */
    readonly incident: boolean;
    /** Delivered while the game was closed (FleetCaughtUp sums these up). */
    readonly away: boolean;
  };
  /** A fleet truck went to the workshop, and the company paid for the repair. */
  FleetTruckRepaired: {
    readonly driverId: string;
    readonly instanceId: string;
    readonly cost: Credits;
  };
  /** The fleet caught up with the time the game was closed: what it did meanwhile. */
  FleetCaughtUp: {
    readonly seconds: number;
    readonly jobs: number;
    /** The contracts' profit, less any repairs. */
    readonly credits: Credits;
  };
  /**
   * Another company leads a city now (RivalService): `leaderId` is the
   * player's company ("player") or a rival; null leaves the city contested.
   */
  CityLeaderChanged: {
    readonly cityId: string;
    readonly previousId: string | null;
    readonly leaderId: string | null;
    /** While the game was closed. */
    readonly away: boolean;
  };
  /** A company ran a campaign in a city: the player's ("player"), or a rival. */
  CampaignRun: {
    readonly companyId: string;
    readonly cityId: string;
    readonly away: boolean;
  };
  /** A rival bought another truck. */
  RivalTruckBought: {
    readonly rivalId: string;
    readonly trucks: number;
    readonly away: boolean;
  };
  /** A contract from a city the company leads paid the leader's bonus on top. */
  LeaderBonusPaid: {
    readonly missionId: string;
    readonly cityId: string;
    readonly bonus: Credits;
  };
  /** A tender came to the job board: a contract the rival races the company for. */
  TenderPosted: {
    readonly missionId: string;
    readonly rivalId: string;
    readonly prize: Credits;
  };
  /** The rival racing the company's tender has unloaded first: the tender is lost. */
  TenderRivalArrived: {
    readonly missionId: string;
    readonly rivalId: string;
  };
  /** A tender the company took is decided: won (the prize paid), or lost to its rival. */
  TenderDecided: {
    readonly missionId: string;
    readonly rivalId: string;
    readonly won: boolean;
    readonly prize: Credits;
  };
  /** The company bought a rival out: it is gone, and its standing is the company's. */
  RivalAcquired: {
    readonly rivalId: string;
    readonly price: Credits;
  };
}
