import { expect, test, type Page } from '@playwright/test';
import { openCompanyHq, openMainMenu, takeContract, watchForProblems } from './support';

function hint(page: Page) {
  return page.locator('.tutorial-hint');
}

test('teaches the first contract and the first upgrade by playing, one short hint at a time', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const problems = watchForProblems(page);
  const html = page.locator('html');
  await openCompanyHq(page, '?debug&lang=en');

  // In the HQ: take the first job, whose button glows. The hint sits above the list.
  await expect(html).toHaveAttribute('data-tutorial-step', 'takeContract');
  await expect(hint(page)).toBeVisible();
  await expect(hint(page)).toContainText('Take your first job');
  await expect(page.locator('.hq__hint .tutorial-hint')).toHaveCount(1);
  const accept = page.locator('.job-card--tutorial [data-action="accept"]');
  await expect(page.locator('.job-card--tutorial')).toHaveAttribute('data-mission-id', 'first_package');
  await expect(accept).toHaveCSS('animation-name', 'tutorial-glow');
  await testInfo.attach('take a contract', { body: await page.screenshot(), contentType: 'image/png' });

  // On the road: drive to the pickup bay, then deliver.
  await takeContract(page, 'first_package');
  await expect(hint(page)).toContainText('Follow the blue line and stop in the yellow bay');
  await testInfo.attach('drive', { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.press('KeyT');
  await expect(html).toHaveAttribute('data-tutorial-step', 'deliver', { timeout: 15_000 });
  await expect(hint(page)).toContainText('Loaded!');
  await page.keyboard.down('ArrowUp');
  await expect(html).toHaveAttribute('data-mission-state', 'delivering', { timeout: 10_000 });
  await page.keyboard.up('ArrowUp');
  await page.keyboard.press('KeyT');

  // The result stands alone; back in the HQ, the pay goes on a first upgrade.
  const result = page.locator('.result-dialog');
  await expect(result).toBeVisible({ timeout: 15_000 });
  await expect(hint(page)).toBeHidden();
  await result.locator('[data-action="continue"]').click();
  await expect(html).toHaveAttribute('data-tutorial-step', 'buyUpgrade');
  await expect(hint(page)).toContainText('Upgrades tab');
  await expect(page.locator('.hq__tab[data-tab="upgrades"]')).toHaveCSS('animation-name', 'tutorial-glow');
  await page.locator('.hq__tab[data-tab="upgrades"]').click();
  await page.locator('.upgrade-card[data-upgrade-id="engine"] [data-action="buy-upgrade"]').click();

  await expect(html).toHaveAttribute('data-tutorial-step', 'done');
  await expect(hint(page)).toBeHidden();
  await expect(page.locator('.toast')).toContainText(['Well done!']);
  expect(problems).toEqual([]);
});

test('lets the player skip the tutorial, for good', async ({ page }) => {
  const problems = watchForProblems(page);
  const html = page.locator('html');
  await openCompanyHq(page, '?lang=en');

  await hint(page).locator('[data-action="skip-tutorial"]').click();

  await expect(hint(page)).toBeHidden();
  await expect(html).toHaveAttribute('data-tutorial-step', 'done');
  await openMainMenu(page, '?lang=en');
  await page.locator('[data-action="continue-game"]').click();
  await expect(html).toHaveAttribute('data-game-state', 'companyHq');
  await expect(html).toHaveAttribute('data-tutorial-step', 'done');
  await expect(hint(page)).toBeHidden();
  expect(problems).toEqual([]);
});
