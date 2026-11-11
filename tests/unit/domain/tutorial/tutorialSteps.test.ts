import { describe, expect, it } from 'vitest';
import {
  pastFirstDelivery,
  tutorialStepAfter,
  TUTORIAL_STEPS,
  TUTORIAL_TRIGGERS,
  type TutorialStep,
} from '../../../../src/domain/tutorial/tutorialSteps';

describe('tutorialStepAfter', () => {
  it('walks a new company through its first contract to its first upgrade', () => {
    let step: TutorialStep = TUTORIAL_STEPS[0];
    for (const trigger of ['contractAccepted', 'cargoLoaded', 'contractCompleted', 'upgradeBought'] as const) {
      step = tutorialStepAfter(step, trigger);
    }

    expect(step).toBe('done');
  });

  it('starts the drive over when the contract fails, and moves on however a contract gets delivered', () => {
    expect(tutorialStepAfter('driveToPickup', 'contractFailed')).toBe('takeContract');
    expect(tutorialStepAfter('deliver', 'contractFailed')).toBe('takeContract');
    expect(tutorialStepAfter('driveToPickup', 'contractCompleted')).toBe('buyUpgrade');
    expect(tutorialStepAfter('takeContract', 'contractCompleted')).toBe('buyUpgrade');
  });

  it('waits for what each step asks, and never leaves done', () => {
    expect(tutorialStepAfter('takeContract', 'upgradeBought')).toBe('takeContract');
    expect(tutorialStepAfter('deliver', 'contractAccepted')).toBe('deliver');
    expect(tutorialStepAfter('buyUpgrade', 'contractCompleted')).toBe('buyUpgrade');
    for (const trigger of TUTORIAL_TRIGGERS) {
      expect(tutorialStepAfter('done', trigger)).toBe('done');
    }
  });
});

describe('pastFirstDelivery', () => {
  it('holds from the first contract delivered on, whether or not the upgrade was bought', () => {
    expect(TUTORIAL_STEPS.filter(pastFirstDelivery)).toEqual(['buyUpgrade', 'done']);
  });
});
