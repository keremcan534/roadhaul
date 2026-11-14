import { expect, test } from '@playwright/test';
import { continueGame, openGame, shownSpeed, watchForProblems } from './support';

test('works the parking brake and the engine brake from the keys and the switches, the engine brake kept', async ({ page }) => {
  test.slow(); // The game started twice, drawn in software.
  const problems = watchForProblems(page);
  await openGame(page, '?traffic=0');
  const controls = page.locator('.touch-controls');
  const parking = page.locator('.brake-switch--parking');
  const engine = page.locator('.brake-switch--engine');
  // The engine brake on, the parking brake off, to start with.
  await expect(controls).toHaveAttribute('data-engine-brake', 'on');
  await expect(controls).toHaveAttribute('data-parking-brake', 'off');

  // Applied, the truck goes nowhere on the gas, and the player is told why.
  await page.keyboard.press('KeyB');
  await expect(controls).toHaveAttribute('data-parking-brake', 'on');
  await expect(parking).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.down('ArrowUp');
  await expect(page.locator('.toast').last()).toContainText('parking brake');
  expect(await shownSpeed(page)).toBe(0);
  await page.keyboard.up('ArrowUp');
  await parking.click();
  await expect(controls).toHaveAttribute('data-parking-brake', 'off');

  // The engine brake switched off, and so it stays for the next drive.
  await page.keyboard.press('KeyJ');
  await expect(controls).toHaveAttribute('data-engine-brake', 'off');
  await expect(page.locator('.toast').last()).toHaveText('Engine brake off');
  await page.reload();
  await continueGame(page);
  await expect(controls).toHaveAttribute('data-engine-brake', 'off');
  await engine.click();
  await expect(controls).toHaveAttribute('data-engine-brake', 'on');
  expect(problems).toEqual([]);
});
