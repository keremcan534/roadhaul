/** What the truck's indicators show: none, the left or the right ones, or all of them (the hazard lights). */
export const TURN_SIGNAL_MODES = ['off', 'left', 'right', 'hazard'] as const;
export type TurnSignalMode = (typeof TURN_SIGNAL_MODES)[number];

/** The flasher's beat: 1.5 flashes a second (a road vehicle's 90 a minute), lit for half of each, lit at once. */
export const FLASH_PERIOD_SECONDS = 2 / 3;
/**
 * A turn signal cancels as a truck's column switch does, on the wheel's
 * return after a turn: once the truck has turned this far toward its side
 * (radians, about 35°: a junction or a roundabout, never a lane change)
 * with the wheel well over toward it (past this share of its travel: not a
 * long gentle curve's), when the wheel comes back under this.
 */
const ARM_TURN_RADIANS = 0.6;
const ARM_STEER = 0.35;
const RELEASE_STEER = 0.12;

/** The indicators' state: kept by TurnSignalService, stepped with the simulation. */
export interface TurnSignals {
  mode: TurnSignalMode;
  /** Seconds since the mode came on: the flasher's phase. */
  seconds: number;
  /** How far the truck has turned toward the signalled side with the wheel well over since it came on, radians. */
  turnedRadians: number;
}

export function createTurnSignals(): TurnSignals {
  return { mode: 'off', seconds: 0, turnedRadians: 0 };
}

/** The player flicked the stalk to `side`: that signal comes on (whatever was on), or goes off if it was on already. */
export function toggleTurnSignal(signals: TurnSignals, side: 'left' | 'right'): void {
  setMode(signals, signals.mode === side ? 'off' : side);
}

/** The hazard switch: every indicator flashing, or none (a turn signal on before is not brought back). */
export function toggleHazardLights(signals: TurnSignals): void {
  setMode(signals, signals.mode === 'hazard' ? 'off' : 'hazard');
}

/** Everything off (a new drive). */
export function clearTurnSignals(signals: TurnSignals): void {
  setMode(signals, 'off');
}

/**
 * The flasher `stepSeconds` on, the wheel at `steer` (-1 full left … +1
 * full right), the truck having turned `turnRadians` this step in the
 * wheel's sense (right positive, forward or reversing): a turn signal goes
 * off once the truck has turned well toward its side and the wheel comes
 * back near the middle (ARM_TURN_RADIANS). The hazard lights stay on until
 * switched off. Allocation-free.
 */
export function stepTurnSignals(signals: TurnSignals, stepSeconds: number, steer: number, turnRadians: number): void {
  if (signals.mode === 'off') {
    return;
  }
  signals.seconds += Math.max(0, stepSeconds);
  if (signals.mode === 'hazard') {
    return;
  }
  const side = signals.mode === 'left' ? -1 : 1;
  const toward = side * steer;
  if (toward > ARM_STEER) {
    signals.turnedRadians = Math.max(0, signals.turnedRadians + side * (Number.isFinite(turnRadians) ? turnRadians : 0));
  } else if (toward < RELEASE_STEER && signals.turnedRadians >= ARM_TURN_RADIANS) {
    setMode(signals, 'off');
  }
}

/** Whether the flashing indicators are lit at this moment (none while off). */
export function flasherLit(signals: Readonly<TurnSignals>): boolean {
  return signals.mode !== 'off' && signals.seconds % FLASH_PERIOD_SECONDS < FLASH_PERIOD_SECONDS / 2;
}

/** Whether the left indicators are lit at this moment. */
export function leftIndicatorLit(signals: Readonly<TurnSignals>): boolean {
  return (signals.mode === 'left' || signals.mode === 'hazard') && flasherLit(signals);
}

/** Whether the right indicators are lit at this moment. */
export function rightIndicatorLit(signals: Readonly<TurnSignals>): boolean {
  return (signals.mode === 'right' || signals.mode === 'hazard') && flasherLit(signals);
}

function setMode(signals: TurnSignals, mode: TurnSignalMode): void {
  signals.mode = mode;
  signals.seconds = 0;
  signals.turnedRadians = 0;
}
