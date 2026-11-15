import { expect, test } from '@playwright/test';
import { openGame, openPanel, watchForProblems } from './support';

test('shows the truck\'s road dirt on the truck page: a new company\'s truck is clean', async ({ page }) => {
  const problems = watchForProblems(page);
  // A caked look for the eye (?dirt=1) leaves what the truck carries as it is.
  await openGame(page, '?lang=en&traffic=0&dirt=1');
  await openPanel(page, 'truck');
  const dirt = page.locator('.truck-gauge--dirt');
  await expect(dirt).toBeVisible();
  await expect(dirt).toHaveAttribute('data-level', 'clean');
  await expect(dirt.locator('.truck-gauge__title')).toHaveText('Road dirt');
  await expect(dirt.locator('.truck-gauge__value')).toHaveText('0% · Clean');
  await expect(dirt.locator('.truck-gauge__note')).toContainText('Wet roads, snow and fields dirty it.');
  expect(problems).toEqual([]);
});
