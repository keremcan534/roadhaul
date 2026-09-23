import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import type { GameEvents } from '../GameEvents';
import { GAME_STATE_TRANSITIONS, type GameState } from './GameState';

/** Owns the top-level game state and announces every change as GameStateChanged. */
export class GameStateService {
  private state: GameState = 'booting';

  constructor(
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {}

  get current(): GameState {
    return this.state;
  }

  canTransitionTo(next: GameState): boolean {
    return GAME_STATE_TRANSITIONS[this.state].includes(next);
  }

  /**
   * Moves to `next` and emits GameStateChanged. Requesting the current state
   * is a no-op, so a double-tapped button is harmless. Any transition that is
   * not in GAME_STATE_TRANSITIONS throws.
   */
  transitionTo(next: GameState): void {
    if (next === this.state) {
      return;
    }
    if (!this.canTransitionTo(next)) {
      throw new Error(`Invalid game state transition: ${this.state} -> ${next}.`);
    }
    const previous = this.state;
    this.state = next;
    this.logger.info(`${previous} -> ${next}`);
    this.events.emit('GameStateChanged', { previous, current: next });
  }
}
