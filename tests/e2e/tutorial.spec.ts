import { expect, test, type Page } from '@playwright/test';
import { openGame, openMainMenu, takeContract, watchForProblems } from './support';

function hint(page: Page) {
  return page.locator('.tutorial-hint');
}

test('teaches the first contract and the first upgrade by playing, one short hint at a time', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const problems = watchForProblems(page);
  const html = page.locator('html');
  await openGame(page, '?debug&lang=en');

  // On the road: the job board's button glows.
  await expect(html).toHaveAttribute('data-tutorial-step', 'takeContract');
  await expect(hint(page)).toBeVisible();
  await expect(hint(page)).toContainText('Take your first job');
  await expect(page.locator('[data-action="dock-jobs"]')).toHaveCSS('animation-name', 'tutorial-glow');
  await testInfo.attach('the road', { body: await page.screenshot(), contentType: 'image/png' });

  // In the job board: take the first job, whose button glows. The hint sits above the list.
  await page.locator('[data-action="dock-jobs"]').click();
  await expect(page.locator('.hq__hint .tutorial-hint')).toHaveCount(1);
  const accept = page.locator('.job-card--tutorial [data-action="accept"]');
  await expect(page.locator('.job-card--tutorial')).toHaveAttribute('data-mission-id', 'first_package');
  await expect(accept).toHaveCSS('animation-name', 'tutorial-glow');
  await testInfo.attach('take a contract', { body: await page.screenshot(), contentType: 'image/png' });

  // On the road: drive to the pickup bay, then deliver.
  await takeContract(page, 'first_package');
  await expect(hint(page)).toContainText('Follow the blue line and stop in the yellow bay');
  await expect(hint(page)).toContainText('the R button to back up');
  await testInfo.attach('drive', { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.press('KeyT');
  await expect(html).toHaveAttribute('data-tutorial-step', 'deliver', { timeout: 15_000 });
  await expect(hint(page)).toContainText('Loaded!');
  await page.keyboard.down('ArrowUp');
  await expect(html).toHaveAttribute('data-mission-state', 'delivering', { timeout: 10_000 });
  await page.keyboard.up('ArrowUp');
  await page.keyboard.press('KeyT');

  // The result stands alone; back on the road, the pay goes on a first upgrade in the garage.
  const result = page.locator('.result-dialog');
  await expect(result).toBeVisible({ timeout: 15_000 });
  await expect(hint(page)).toBeHidden();
  await result.locator('[data-action="continue"]').click();
  await expect(html).toHaveAttribute('data-tutorial-step', 'buyUpgrade');
  await expect(hint(page)).toContainText('Open the Garage');
  await expect(page.locator('[data-action="dock-garage"]')).toHaveCSS('animation-name', 'tutorial-glow');
  await page.locator('[data-action="dock-garage"]').click();
  const buy = page.locator('.upgrade-card[data-upgrade-id="engine"] [data-action="buy-upgrade"]');
  await expect(buy).toHaveCSS('animation-name', 'tutorial-glow');
  await buy.click();

  await expect(html).toHaveAttribute('data-tutorial-step', 'done');
  await expect(hint(page)).toBeHidden();
  await expect(page.locator('.toast')).toContainText(['Well done!']);
  expect(problems).toEqual([]);
});

test('lets the player skip the tutorial, for good', async ({ page }) => {
  const problems = watchForProblems(page);
  const html = page.locator('html');
  await openGame(page, '?lang=en');

  await hint(page).locator('[data-action="skip-tutorial"]').click();

  await expect(hint(page)).toBeHidden();
  await expect(html).toHaveAttribute('data-tutorial-step', 'done');
  await expect(page.locator('[data-action="dock-jobs"]')).not.toHaveCSS('animation-name', 'tutorial-glow');
  await openMainMenu(page, '?lang=en');
  await page.locator('[data-action="continue-game"]').click();
  await expect(html).toHaveAttribute('data-game-state', 'driving');
  await expect(html).toHaveAttribute('data-tutorial-step', 'done');
  await expect(hint(page)).toBeHidden();
  expect(problems).toEqual([]);
});
