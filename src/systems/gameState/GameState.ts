import { frozenCopy } from '../../core/objects/frozenCopy';

/**
 * Top-level game flow (spec §9). Starting or continuing a company goes
 * straight into the world, where the truck waits: the company HQ's pages
 * (job board, truck, garage, events) open as panels over the game, so they
 * are UI navigation, not game states. The delivery stages (pickup, transit,
 * delivery) belong to the mission state machine.
 */
export const GAME_STATES = ['booting', 'mainMenu', 'driving'] as const;
export type GameState = (typeof GAME_STATES)[number];

/** Allowed transitions. Anything not listed here is a bug. */
export const GAME_STATE_TRANSITIONS = frozenCopy<Readonly<Record<GameState, readonly GameState[]>>>({
  booting: ['mainMenu'],
  mainMenu: ['driving'],
  driving: ['mainMenu'],
});
