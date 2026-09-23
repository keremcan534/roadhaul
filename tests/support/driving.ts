import type { VehicleDynamics } from '../../src/domain/vehicles/VehicleDynamics';
import type { VehicleInput } from '../../src/domain/vehicles/VehicleInput';
import type { VehicleRuntimeState } from '../../src/domain/vehicles/VehicleRuntimeState';
import { ASPHALT, type Surface } from '../../src/domain/world/Surface';

export const STEP_SECONDS = 1 / 60;

export function input(overrides: Partial<VehicleInput> = {}): VehicleInput {
  return { steer: 0, throttle: 0, brake: 0, ...overrides };
}

/**
 * Steps the model at 60 Hz for up to `seconds`, stopping early when `until`
 * returns true. Returns the simulated time.
 */
export function drive(
  dynamics: VehicleDynamics,
  state: VehicleRuntimeState,
  driverInput: VehicleInput,
  seconds: number,
  options: { surface?: Surface; until?: (state: VehicleRuntimeState) => boolean } = {},
): number {
  const surface = options.surface ?? ASPHALT;
  let elapsed = 0;
  while (elapsed < seconds - 1e-9) {
    if (options.until?.(state) === true) {
      break;
    }
    dynamics.step(state, driverInput, surface, STEP_SECONDS);
    elapsed += STEP_SECONDS;
  }
  return elapsed;
}

export function kmh(state: VehicleRuntimeState): number {
  return state.speed * 3.6;
}
