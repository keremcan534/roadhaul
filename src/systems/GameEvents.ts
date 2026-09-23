import type { Credits, Fraction } from '../data/units';
import type { MissionFailureReason, MissionState } from '../domain/missions/MissionInstance';
import type { MissionReward } from '../domain/missions/missionReward';
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
    readonly reward: MissionReward;
    readonly deliverySeconds: number;
    readonly cargoDamage: Fraction;
    readonly xp: number;
    readonly reputation: number;
  };
  MissionFailed: {
    readonly missionId: string;
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
}
