import { expect, test, type Page } from '@playwright/test';
import { openGame, shownSpeed, watchForProblems } from './support';

const html = (page: Page) => page.locator('html');

test('races the club\'s cars from the race club: the lights, the race car, giving up, and the truck again', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  // A new company's truck by North Valley's race club on the east road, parked on its lot.
  await openGame(page, '?debug&lang=en&traffic=0&spawn=2862,700,7');
  await page.keyboard.press('KeyG');
  const panel = page.locator('.place-panel');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel).toHaveAttribute('data-kind', 'raceClub');
  await expect(panel.locator('.place-panel__name')).toHaveText('Ridgeway Race Club');
  await expect(panel.locator('.place-panel__line')).toContainText('Races left today: 3');

  await panel.locator('[data-action="place-action"]').click();
  await expect(html(page)).toHaveAttribute('data-race', 'on');
  const hud = page.locator('.race-hud');
  await expect(hud.locator('.race-hud__bar')).toBeVisible();
  // The rivals line up ahead: last on the grid.
  await expect(hud.locator('[data-value="race-place"]')).toHaveText('Place 4/4');
  await expect(hud.locator('[data-value="race-lights"]')).toHaveText(/^[123]$/);
  await expect(page.locator('.hud-dock')).toBeHidden();
  await expect(panel).toBeHidden();
  await expect(hud.locator('[data-value="race-lights"]')).toHaveText('GO!', { timeout: 20_000 });

  await page.keyboard.down('ArrowUp');
  await expect.poll(() => shownSpeed(page), { timeout: 30_000 }).toBeGreaterThan(40);
  await page.keyboard.up('ArrowUp');

  await hud.locator('[data-action="race-quit"]').click();
  const result = page.locator('.race-result');
  await expect(result).toBeVisible();
  await expect(result.locator('.race-result__title')).toHaveText('You gave up the race.');
  await result.locator('[data-action="race-result-close"]').click();
  await expect(result).toBeHidden();
  await expect(html(page)).toHaveAttribute('data-race', 'off');
  // In the truck again, at the club, a race fewer left today.
  await expect(panel).toBeVisible();
  await expect(panel.locator('.place-panel__line')).toContainText('Races left today: 2');
  expect(problems).toEqual([]);
});
