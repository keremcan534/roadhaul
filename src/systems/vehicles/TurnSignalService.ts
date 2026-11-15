import {
  clearTurnSignals,
  createTurnSignals,
  leftIndicatorLit,
  rightIndicatorLit,
  stepTurnSignals,
  toggleHazardLights,
  toggleTurnSignal,
  type TurnSignalMode,
} from '../../domain/vehicles/turnSignals';
import type { VehicleRuntimeState } from '../../domain/vehicles/VehicleRuntimeState';

/**
 * The truck's indicators (domain/vehicles/turnSignals.ts): the player's
 * stalk and hazard switch, the flasher stepped with the simulation, and a
 * turn signal cancelled by the wheel's return after a turn. Nothing of it is
 * saved: a drive starts with them off. The truck's lamps, the dashboard's
 * arrows and the relay's tick read it each frame.
 */
export class TurnSignalService {
  private readonly signals = createTurnSignals();

  get mode(): TurnSignalMode {
    return this.signals.mode;
  }

  /** Whether the left indicators are lit at this moment of their flashing. */
  get leftLit(): boolean {
    return leftIndicatorLit(this.signals);
  }

  /** Whether the right indicators are lit at this moment of their flashing. */
  get rightLit(): boolean {
    return rightIndicatorLit(this.signals);
  }

  /** The left or right stalk: that signal on, or off when it was on. */
  toggle(side: 'left' | 'right'): void {
    toggleTurnSignal(this.signals, side);
  }

  /** The hazard switch. */
  toggleHazard(): void {
    toggleHazardLights(this.signals);
  }

  /**
   * Each fixed step on the road, after the truck's (`vehicle`): its wheel
   * and how far its path turned this step cancel a turn signal after a
   * turn. Allocation-free.
   */
  update(stepSeconds: number, vehicle: Readonly<Pick<VehicleRuntimeState, 'steerPosition' | 'pathCurvature' | 'speed'>>): void {
    stepTurnSignals(this.signals, stepSeconds, vehicle.steerPosition, vehicle.pathCurvature * Math.abs(vehicle.speed) * stepSeconds);
  }

  /** All off: a new drive. */
  reset(): void {
    clearTurnSignals(this.signals);
  }
}
