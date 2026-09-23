import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { GAME_STATES, GAME_STATE_TRANSITIONS, type GameState } from '../../../../src/systems/gameState/GameState';
import { GameStateService } from '../../../../src/systems/gameState/GameStateService';
import { MemoryLogger } from '../../../support/MemoryLogger';

function createService() {
  const logger = new MemoryLogger();
  const events = new EventBus<GameEvents>(logger);
  const changes: GameEvents['GameStateChanged'][] = [];
  events.on('GameStateChanged', (change) => changes.push(change));
  return { service: new GameStateService(events, logger), changes, logger };
}

describe('GameStateService', () => {
  it('starts in the booting state', () => {
    expect(createService().service.current).toBe('booting');
  });

  it('follows the core loop and announces every change', () => {
    const { service, changes } = createService();

    service.transitionTo('mainMenu');
    service.transitionTo('companyHq');
    service.transitionTo('driving');
    service.transitionTo('companyHq');

    expect(service.current).toBe('companyHq');
    expect(changes).toEqual([
      { previous: 'booting', current: 'mainMenu' },
      { previous: 'mainMenu', current: 'companyHq' },
      { previous: 'companyHq', current: 'driving' },
      { previous: 'driving', current: 'companyHq' },
    ]);
  });

  it('treats a transition to the current state as a no-op', () => {
    const { service, changes } = createService();
    service.transitionTo('mainMenu');

    service.transitionTo('mainMenu');

    expect(changes).toHaveLength(1);
  });

  it('rejects transitions that are not allowed and keeps the current state', () => {
    const { service, changes } = createService();

    expect(() => service.transitionTo('driving')).toThrow('Invalid game state transition: booting -> driving.');
    expect(service.current).toBe('booting');
    expect(changes).toEqual([]);
  });

  it('answers canTransitionTo from the transition table', () => {
    const { service } = createService();

    expect(service.canTransitionTo('mainMenu')).toBe(true);
    expect(service.canTransitionTo('companyHq')).toBe(false);
  });

  it('has a transition table in which every state is reachable and can be left', () => {
    const reachable = new Set<GameState>(['booting']);
    const queue: GameState[] = ['booting'];
    for (let state = queue.shift(); state !== undefined; state = queue.shift()) {
      for (const next of GAME_STATE_TRANSITIONS[state]) {
        if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }

    expect([...reachable].sort()).toEqual([...GAME_STATES].sort());
    for (const state of GAME_STATES) {
      expect(GAME_STATE_TRANSITIONS[state].length, `${state} has no way out`).toBeGreaterThan(0);
    }
  });
});
