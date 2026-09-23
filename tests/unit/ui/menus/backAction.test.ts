import { describe, expect, it } from 'vitest';
import { backAction, type BackContext } from '../../../../src/ui/menus/backAction';

const nothingOpen: BackContext = { gameState: 'mainMenu', menuDialogOpen: false, pauseMenuOpen: false, resultOpen: false };

describe('backAction', () => {
  it('pauses the drive, and resumes it', () => {
    expect(backAction({ ...nothingOpen, gameState: 'driving' })).toBe('pause');
    expect(backAction({ ...nothingOpen, gameState: 'driving', pauseMenuOpen: true })).toBe('resume');
  });

  it('leaves the result of a contract to its own button', () => {
    expect(backAction({ ...nothingOpen, gameState: 'driving', resultOpen: true })).toBe('stay');
  });

  it('takes the HQ back to the main menu, and puts the app away from there', () => {
    expect(backAction({ ...nothingOpen, gameState: 'companyHq' })).toBe('mainMenu');
    expect(backAction(nothingOpen)).toBe('leaveApp');
    expect(backAction({ ...nothingOpen, gameState: 'booting' })).toBe('leaveApp');
  });

  it('closes a dialog over the main menu first', () => {
    expect(backAction({ ...nothingOpen, menuDialogOpen: true })).toBe('closeDialog');
  });
});
