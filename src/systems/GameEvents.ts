import type { GameState } from './gameState/GameState';

/**
 * Every event that crosses system boundaries, keyed by name (spec §57).
 * Systems emit them. Presentation and UI subscribe and never change game state
 * directly. Add new events here as systems arrive (MissionCompleted,
 * MoneyChanged, FuelChanged, VehicleDamaged, ...).
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
}
