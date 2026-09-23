/**
 * The first ten minutes (spec §41), taught by playing: take a contract,
 * drive to the pickup bay and load, deliver and get paid, then spend the pay
 * on a first upgrade. Each step waits for the player to do it.
 */
export const TUTORIAL_STEPS = ['takeContract', 'driveToPickup', 'deliver', 'buyUpgrade', 'done'] as const;
export type TutorialStep = (typeof TUTORIAL_STEPS)[number];

/** What the player did that the tutorial follows. */
export const TUTORIAL_TRIGGERS = [
  'contractAccepted',
  'cargoLoaded',
  'contractCompleted',
  'contractFailed',
  'upgradeBought',
] as const;
export type TutorialTrigger = (typeof TUTORIAL_TRIGGERS)[number];

/**
 * The step after `step` once the player has done `trigger`; `step` itself
 * when that does not move the tutorial on. A contract that fails part way
 * starts the drive over; any delivered contract leads on to the upgrade.
 */
export function tutorialStepAfter(step: TutorialStep, trigger: TutorialTrigger): TutorialStep {
  switch (step) {
    case 'takeContract':
      return trigger === 'contractAccepted' ? 'driveToPickup' : trigger === 'contractCompleted' ? 'buyUpgrade' : step;
    case 'driveToPickup':
    case 'deliver':
      if (trigger === 'contractFailed') {
        return 'takeContract';
      }
      if (trigger === 'contractCompleted') {
        return 'buyUpgrade';
      }
      return trigger === 'cargoLoaded' ? 'deliver' : step;
    case 'buyUpgrade':
      return trigger === 'upgradeBought' ? 'done' : step;
    case 'done':
      return step;
  }
}
