import { describe, expect, it } from 'vitest';
import {
  clearTurnSignals,
  createTurnSignals,
  FLASH_PERIOD_SECONDS,
  flasherLit,
  leftIndicatorLit,
  rightIndicatorLit,
  stepTurnSignals,
  toggleHazardLights,
  toggleTurnSignal,
  type TurnSignals,
} from '../../../../src/domain/vehicles/turnSignals';

/** Steps `seconds` at 60 Hz with the wheel at `steer`, the truck turning `turnRate` radians a second (right positive). */
function drive(signals: TurnSignals, seconds: number, steer = 0, turnRate = 0): void {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
    stepTurnSignals(signals, 1 / 60, steer, turnRate / 60);
  }
}

describe('turn signals', () => {
  it('flash 1.5 times a second, lit at once, on the side switched on', () => {
    const signals = createTurnSignals();
    expect(flasherLit(signals)).toBe(false);
    toggleTurnSignal(signals, 'left');
    expect(leftIndicatorLit(signals)).toBe(true);
    expect(rightIndicatorLit(signals)).toBe(false);
    drive(signals, FLASH_PERIOD_SECONDS * 0.6);
    expect(leftIndicatorLit(signals)).toBe(false);
    drive(signals, FLASH_PERIOD_SECONDS * 0.5);
    expect(leftIndicatorLit(signals)).toBe(true);
    // Lit for half of each flash: about 1.5 flashes and half the time over 10 s.
    let lit = 0;
    let flashes = 0;
    let was = leftIndicatorLit(signals);
    for (let i = 0; i < 600; i++) {
      stepTurnSignals(signals, 1 / 60, 0, 0);
      const now = leftIndicatorLit(signals);
      if (now) lit++;
      if (now && !was) flashes++;
      was = now;
    }
    expect(lit / 600).toBeCloseTo(0.5, 1);
    expect(flashes).toBeGreaterThanOrEqual(14);
    expect(flashes).toBeLessThanOrEqual(16);
  });

  it('switch from one side to the other, and off when flicked again', () => {
    const signals = createTurnSignals();
    toggleTurnSignal(signals, 'left');
    toggleTurnSignal(signals, 'right');
    expect(signals.mode).toBe('right');
    toggleTurnSignal(signals, 'right');
    expect(signals.mode).toBe('off');
  });

  it('cancel once the truck has turned toward their side and the wheel comes back, not after a lane change or a curve', () => {
    const signals = createTurnSignals();
    toggleTurnSignal(signals, 'right');
    // A lane change: the wheel a little right and back, the truck's heading a few degrees off and back.
    drive(signals, 1, 0.4, 0.1);
    drive(signals, 1, -0.4, -0.1);
    drive(signals, 1, 0, 0);
    expect(signals.mode).toBe('right');
    // A turn the other way does not cancel it, nor count against the next.
    drive(signals, 2, -0.8, -0.8);
    drive(signals, 1, 0, 0);
    expect(signals.mode).toBe('right');
    // A long gentle curve toward it, the wheel barely over: still on.
    drive(signals, 8, 0.1, 0.15);
    drive(signals, 1, 0, 0);
    expect(signals.mode).toBe('right');
    toggleTurnSignal(signals, 'right');
    toggleTurnSignal(signals, 'right');
    // A turn to the right at a junction: the wheel well over, a quarter turn, then back.
    drive(signals, 2, 0.7, 0.8);
    expect(signals.mode).toBe('right');
    drive(signals, 0.5, 0.05, 0.02);
    expect(signals.mode).toBe('off');
    expect(flasherLit(signals)).toBe(false);
    // Reversing round to the left with the wheel to the left counts as a left turn too (the wheel's sense).
    toggleTurnSignal(signals, 'left');
    drive(signals, 2, -0.8, -0.5);
    drive(signals, 0.5, 0, 0);
    expect(signals.mode).toBe('off');
  });

  it('keep the hazard lights flashing on both sides through any steering, until switched off', () => {
    const signals = createTurnSignals();
    toggleTurnSignal(signals, 'left');
    toggleHazardLights(signals);
    expect(leftIndicatorLit(signals)).toBe(true);
    expect(rightIndicatorLit(signals)).toBe(true);
    drive(signals, 2, -0.9, -0.9);
    drive(signals, 2, 0, 0);
    expect(signals.mode).toBe('hazard');
    toggleHazardLights(signals);
    expect(signals.mode).toBe('off');
    toggleHazardLights(signals);
    clearTurnSignals(signals);
    expect(signals.mode).toBe('off');
  });
});
