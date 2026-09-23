import { isLogLevel, type LogLevel } from '../../core/logging/Logger';
import { frozenCopy } from '../../core/objects/frozenCopy';
import { Validator, type ValidationIssue } from '../../core/validation/Validator';
import type { ContentCatalog } from '../ContentCatalog';
import type { Credits } from '../units';

/**
 * Central tuning values (spec §17: prices and limits live in config, not in
 * world objects). Game code receives the config through the composition root.
 */
export interface GameConfig {
  readonly simulation: {
    /** Duration of one fixed simulation step. */
    readonly fixedStepSeconds: number;
    /** Cap on catch-up steps per frame on slow devices. */
    readonly maxStepsPerFrame: number;
    /** Longer frames are clamped to this (tab switches, hitches). */
    readonly maxFrameDeltaSeconds: number;
  };
  readonly rendering: {
    /**
     * Upper bound for the device pixel ratio. Phones report 2.5 to 4, and
     * rendering at that resolution costs more fill rate than low/mid devices have.
     */
    readonly maxPixelRatio: number;
    readonly antialias: boolean;
  };
  readonly newGame: {
    readonly startingCredits: Credits;
    /** VehicleDefinition id of the truck every new company starts with. */
    readonly startingVehicleId: string;
    /** MapDefinition id the driving starts on. */
    readonly startingMapId: string;
  };
  readonly debug: {
    readonly logLevel: LogLevel;
    /** Shows FPS, draw calls and triangles (enable in the browser with `?debug`). */
    readonly showPerfOverlay: boolean;
  };
}

export const DEFAULT_GAME_CONFIG: GameConfig = frozenCopy<GameConfig>({
  simulation: {
    fixedStepSeconds: 1 / 60,
    maxStepsPerFrame: 5,
    maxFrameDeltaSeconds: 0.25,
  },
  rendering: {
    maxPixelRatio: 1.5,
    antialias: false,
  },
  newGame: {
    startingCredits: 5000, // Placeholder until the economy step (roadmap step 14).
    startingVehicleId: 'rh_h1',
    startingMapId: 'test_track',
  },
  debug: {
    logLevel: 'info',
    showPerfOverlay: false,
  },
});

/** Checks value ranges and that the config only references existing content. */
export function validateGameConfig(config: GameConfig, content: ContentCatalog): readonly ValidationIssue[] {
  const validator = new Validator();
  const { simulation, rendering, newGame, debug } = config;

  validator.check(
    Number.isFinite(simulation.fixedStepSeconds) &&
      simulation.fixedStepSeconds > 0 &&
      simulation.fixedStepSeconds <= 0.1,
    'simulation.fixedStepSeconds',
    'must be greater than 0 and at most 0.1',
  );
  validator.positiveInteger(simulation.maxStepsPerFrame, 'simulation.maxStepsPerFrame');
  validator.check(
    Number.isFinite(simulation.maxFrameDeltaSeconds) && simulation.maxFrameDeltaSeconds >= simulation.fixedStepSeconds,
    'simulation.maxFrameDeltaSeconds',
    'must be at least fixedStepSeconds',
  );
  validator.positiveNumber(rendering.maxPixelRatio, 'rendering.maxPixelRatio');
  validator.boolean(rendering.antialias, 'rendering.antialias');
  validator.nonNegativeInteger(newGame.startingCredits, 'newGame.startingCredits');
  validator.check(
    content.vehicles.has(newGame.startingVehicleId),
    'newGame.startingVehicleId',
    `unknown vehicle "${newGame.startingVehicleId}"`,
  );
  validator.check(
    content.maps.has(newGame.startingMapId),
    'newGame.startingMapId',
    `unknown map "${newGame.startingMapId}"`,
  );
  validator.check(isLogLevel(debug.logLevel), 'debug.logLevel', `unknown log level "${debug.logLevel}"`);
  validator.boolean(debug.showPerfOverlay, 'debug.showPerfOverlay');
  return validator.issues;
}
