import { frozenCopy } from '../../core/objects/frozenCopy';

/**
 * Top-level game flow (spec §9). Screens inside the company HQ (job board,
 * garage, upgrades) are UI navigation, not game states; the delivery stages
 * (pickup, transit, delivery) belong to the mission state machine.
 */
export const GAME_STATES = ['booting', 'mainMenu', 'companyHq', 'driving'] as const;
export type GameState = (typeof GAME_STATES)[number];

/** Allowed transitions. Anything not listed here is a bug. */
export const GAME_STATE_TRANSITIONS = frozenCopy<Readonly<Record<GameState, readonly GameState[]>>>({
  booting: ['mainMenu'],
  mainMenu: ['companyHq'],
  companyHq: ['mainMenu', 'driving'],
  driving: ['companyHq'],
});
