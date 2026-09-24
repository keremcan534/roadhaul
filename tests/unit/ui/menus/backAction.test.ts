import { describe, expect, it } from 'vitest';
import { backAction, type BackContext } from '../../../../src/ui/menus/backAction';

const nothingOpen: BackContext = {
  gameState: 'mainMenu',
  menuDialogOpen: false,
  panelOpen: false,
  pauseMenuOpen: false,
  resultOpen: false,
};

describe('backAction', () => {
  it('pauses the game, and resumes it', () => {
    expect(backAction({ ...nothingOpen, gameState: 'driving' })).toBe('pause');
    expect(backAction({ ...nothingOpen, gameState: 'driving', pauseMenuOpen: true })).toBe('resume');
  });

  it('closes the company panel over the road', () => {
    expect(backAction({ ...nothingOpen, gameState: 'driving', panelOpen: true })).toBe('closePanel');
  });

  it('leaves the result of a contract to its own buttons', () => {
    expect(backAction({ ...nothingOpen, gameState: 'driving', resultOpen: true })).toBe('stay');
    expect(backAction({ ...nothingOpen, gameState: 'driving', resultOpen: true, panelOpen: true })).toBe('stay');
  });

  it('puts the app away from the main menu', () => {
    expect(backAction(nothingOpen)).toBe('leaveApp');
    expect(backAction({ ...nothingOpen, gameState: 'booting' })).toBe('leaveApp');
  });

  it('closes a dialog first: over the main menu, the pause menu or the panel', () => {
    expect(backAction({ ...nothingOpen, menuDialogOpen: true })).toBe('closeDialog');
    expect(backAction({ ...nothingOpen, gameState: 'driving', panelOpen: true, menuDialogOpen: true })).toBe('closeDialog');
  });
});
