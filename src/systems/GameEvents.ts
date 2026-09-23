import type { MissionFailureReason, MissionState } from '../domain/missions/MissionInstance';
import type { MissionReward } from '../domain/missions/missionReward';
import type { Fraction } from '../data/units';
import type { GameState } from './gameState/GameState';

/**
 * Every event that crosses system boundaries, keyed by name (spec §57).
 * Systems emit them. Presentation and UI subscribe and never change game state
 * directly. Add new events here as systems arrive (MoneyChanged, FuelChanged,
 * VehicleDamaged, ...).
 */
export interface GameEvents {
  GameStateChanged: {
    readonly previous: GameState;
    readonly current: GameState;
  };
  /** The truck hit a tree, building or the map edge. DamageService (roadmap step 16) will turn this into damage. */
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
  /** The cargo was unloaded at its destination. EconomyService (roadmap step 14) will pay the reward. */
  MissionCompleted: {
    readonly missionId: string;
    readonly reward: MissionReward;
    readonly deliverySeconds: number;
    readonly cargoDamage: Fraction;
  };
  MissionFailed: {
    readonly missionId: string;
    readonly reason: MissionFailureReason;
  };
}
