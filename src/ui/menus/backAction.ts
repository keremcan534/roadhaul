import type { GameState } from '../../systems/gameState/GameState';

/** What is on the screen, as the back button sees it. */
export interface BackContext {
  readonly gameState: GameState;
  /** A dialog is open over the game: the settings (over the main or pause menu), the map or the new company form. */
  readonly menuDialogOpen: boolean;
  /** The company's panel (jobs, truck, garage, events) is open over the road. */
  readonly panelOpen: boolean;
  readonly pauseMenuOpen: boolean;
  readonly resultOpen: boolean;
}

export type BackAction = 'closeDialog' | 'closePanel' | 'pause' | 'resume' | 'stay' | 'leaveApp';

/**
 * What Android's back button does: it closes the dialog or panel that is
 * open, pauses the game (and resumes it), and at the main menu puts the app
 * away. The pause menu leads to the main menu. The result of a contract
 * waits for its own buttons.
 */
export function backAction(context: BackContext): BackAction {
  if (context.menuDialogOpen) {
    return 'closeDialog';
  }
  switch (context.gameState) {
    case 'driving':
      if (context.resultOpen) {
        return 'stay';
      }
      if (context.panelOpen) {
        return 'closePanel';
      }
      return context.pauseMenuOpen ? 'resume' : 'pause';
    case 'mainMenu':
    case 'booting':
      return 'leaveApp';
  }
}
