import type { GameState } from '../../systems/gameState/GameState';

/** What is on the screen, as the back button sees it. */
export interface BackContext {
  readonly gameState: GameState;
  /** A dialog over the main menu is open: the settings or the new company form. */
  readonly menuDialogOpen: boolean;
  readonly pauseMenuOpen: boolean;
  readonly resultOpen: boolean;
}

export type BackAction = 'closeDialog' | 'pause' | 'resume' | 'stay' | 'mainMenu' | 'leaveApp';

/**
 * What Android's back button does: it closes the dialog that is open,
 * pauses the drive (and resumes it), takes the HQ back to the main menu, and
 * at the main menu puts the app away. The result of a contract waits for its
 * own button.
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
      return context.pauseMenuOpen ? 'resume' : 'pause';
    case 'companyHq':
      return 'mainMenu';
    case 'mainMenu':
    case 'booting':
      return 'leaveApp';
  }
}
