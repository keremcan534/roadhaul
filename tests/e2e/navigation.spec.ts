import { expect, test } from '@playwright/test';
import { openCompanyHq, takeContract, watchForProblems } from './support';

/**
 * A day whose road works leave the coast road from Havenport to Saltcove open: the GPS goes round a day's road works
 * (RoadNetwork.setDetour), and on the tests' usual date one lies on it, which makes the first turn 2.5 km off.
 */
const COAST_ROAD_OPEN = { date: '2025-11-30' };

test('guides the delivery: the next turn, the distance by road and the arrival time', async ({ page }) => {
  const problems = watchForProblems(page);
  await openCompanyHq(page, '?debug&lang=en', COAST_ROAD_OPEN);
  // From Havenport's depot to Saltcove's, the nearest town: the first turn is to the right.
  await takeContract(page, 'first_package');
  await page.keyboard.press('KeyT');
  await expect(page.locator('html')).toHaveAttribute('data-mission-state', 'loaded', { timeout: 15_000 });

  const turn = page.locator('.mission-hud__turn');
  await expect(turn).toBeVisible();
  await expect(turn).toHaveAttribute('data-turn', 'right');
  await expect(turn).toContainText(/^Turn right in \d+ m$/);
  await expect(page.locator('.mission-hud__distance')).toHaveText(/km$/);
  await expect(page.locator('.mission-hud__eta')).toHaveText(/^ETA \d+:\d\d$/);
  await expect(page.locator('.mission-hud__eta')).not.toHaveClass(/is-late/);
  expect(problems).toEqual([]);
});

test('speaks the turns in Turkish', async ({ page }) => {
  await openCompanyHq(page, '?debug&lang=tr', COAST_ROAD_OPEN);
  await takeContract(page, 'first_package');
  await page.keyboard.press('KeyT');
  await expect(page.locator('html')).toHaveAttribute('data-mission-state', 'loaded', { timeout: 15_000 });

  await expect(page.locator('.mission-hud__turn')).toContainText(/^\d+ m sonra sağa dönün$/);
  await expect(page.locator('.mission-hud__eta')).toHaveText(/^Varış \d+:\d\d$/);
});
