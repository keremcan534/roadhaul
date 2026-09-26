import { expect, test } from '@playwright/test';
import { openCompanyHq, takeContract, watchForProblems } from './support';

test('guides the delivery: the next turn, the distance by road and the arrival time', async ({ page }) => {
  const problems = watchForProblems(page);
  await openCompanyHq(page, '?debug&lang=en');
  // From Havenport's depot to Ironford's: up the high street, then left towards the highway.
  await takeContract(page, 'first_package');
  await page.keyboard.press('KeyT');
  await expect(page.locator('html')).toHaveAttribute('data-mission-state', 'loaded', { timeout: 15_000 });

  const turn = page.locator('.mission-hud__turn');
  await expect(turn).toBeVisible();
  await expect(turn).toHaveAttribute('data-turn', 'left');
  await expect(turn).toContainText(/^Turn left in \d+ m$/);
  await expect(page.locator('.mission-hud__distance')).toHaveText(/km$/);
  await expect(page.locator('.mission-hud__eta')).toHaveText(/^ETA \d+:\d\d$/);
  await expect(page.locator('.mission-hud__eta')).not.toHaveClass(/is-late/);
  expect(problems).toEqual([]);
});

test('speaks the turns in Turkish', async ({ page }) => {
  await openCompanyHq(page, '?debug&lang=tr');
  await takeContract(page, 'first_package');
  await page.keyboard.press('KeyT');
  await expect(page.locator('html')).toHaveAttribute('data-mission-state', 'loaded', { timeout: 15_000 });

  await expect(page.locator('.mission-hud__turn')).toContainText(/^\d+ m sonra sola dönün$/);
  await expect(page.locator('.mission-hud__eta')).toHaveText(/^Varış \d+:\d\d$/);
});
