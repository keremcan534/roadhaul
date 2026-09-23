import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { tutorialStepAfter, type TutorialStep, type TutorialTrigger } from '../../domain/tutorial/tutorialSteps';
import type { GameEvents } from '../GameEvents';

/**
 * The tutorial (spec §41): follows what the player does, through the game's
 * events, and knows the step to show a hint for. It never blocks anything;
 * the player can skip it. Once per company: the save keeps the step.
 * Emits TutorialStepChanged.
 */
export class TutorialService {
  private current: TutorialStep = 'done';
  private readonly unsubscribe: Unsubscribe[];

  constructor(
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {
    this.unsubscribe = [
      events.on('MissionStateChanged', ({ previous, current }) => {
        if (previous === null) {
          this.advance('contractAccepted');
        } else if (current === 'loaded') {
          this.advance('cargoLoaded');
        }
      }),
      events.on('MissionCompleted', () => this.advance('contractCompleted')),
      events.on('MissionFailed', () => this.advance('contractFailed')),
      events.on('UpgradePurchased', () => this.advance('upgradeBought')),
    ];
  }

  get step(): TutorialStep {
    return this.current;
  }

  get isActive(): boolean {
    return this.current !== 'done';
  }

  /** Ends the tutorial for this company. */
  skip(): void {
    if (this.isActive) {
      this.logger.info(`Tutorial skipped at ${this.current}.`);
      this.moveTo('done');
    }
  }

  /** Takes over the step of a loaded or new game. No event. */
  restore(step: TutorialStep): void {
    this.current = step;
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribe) {
      unsubscribe();
    }
  }

  private advance(trigger: TutorialTrigger): void {
    const next = tutorialStepAfter(this.current, trigger);
    if (next !== this.current) {
      this.moveTo(next);
    }
  }

  private moveTo(step: TutorialStep): void {
    const previous = this.current;
    this.current = step;
    this.events.emit('TutorialStepChanged', { step, previous });
  }
}
