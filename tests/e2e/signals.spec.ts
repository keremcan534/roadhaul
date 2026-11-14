import { expect, test } from '@playwright/test';
import { continueGame, openGame, watchForProblems } from './support';

test('switches the turn signals and the hazard lights from the keys and the dashboard, off again for a new drive', async ({ page }) => {
  test.slow(); // The game started twice, drawn in software.
  const problems = watchForProblems(page);
  await openGame(page, '?traffic=0');
  const controls = page.locator('.touch-controls');
  const left = page.locator('.signal-button--left');
  const right = page.locator('.signal-button--right');
  const hazards = page.locator('.hazard-button');
  await expect(controls).toHaveAttribute('data-signal', 'off');

  // The stalk: Q left, E right, the same again off; the dashboard's arrows the same.
  await page.keyboard.press('KeyQ');
  await expect(controls).toHaveAttribute('data-signal', 'left');
  await expect(left).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('KeyE');
  await expect(controls).toHaveAttribute('data-signal', 'right');
  await expect(left).toHaveAttribute('aria-pressed', 'false');
  await expect(right).toHaveAttribute('aria-pressed', 'true');
  await right.click();
  await expect(controls).toHaveAttribute('data-signal', 'off');
  await left.click();
  await expect(controls).toHaveAttribute('data-signal', 'left');

  // The hazard switch: its button or X, over a turn signal; off again, nothing comes back.
  await hazards.click();
  await expect(controls).toHaveAttribute('data-signal', 'hazard');
  await expect(hazards).toHaveAttribute('aria-pressed', 'true');
  await expect(left).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('KeyX');
  await expect(controls).toHaveAttribute('data-signal', 'off');
  await expect(hazards).toHaveAttribute('aria-pressed', 'false');

  // Left flashing as the drive ends: the next one starts with every indicator off.
  await page.keyboard.press('KeyX');
  await expect(controls).toHaveAttribute('data-signal', 'hazard');
  await page.locator('.pause-button').click();
  await page.locator('[data-action="pause-main-menu"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-game-state', 'mainMenu');
  await continueGame(page);
  await expect(controls).toHaveAttribute('data-signal', 'off');
  expect(problems).toEqual([]);
});
