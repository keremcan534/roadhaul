import { expect, test } from '@playwright/test';
import { openGame, openPanel, watchForProblems } from './support';

test('shows the Road Pass beside the goals, and opens Plus\'s colours once bought in the shop', async ({ page }, testInfo) => {
  test.slow();
  const problems = watchForProblems(page);
  await openGame(page, '?traffic=0&lang=en&store=simulated');
  await openPanel(page, 'jobs');
  await page.locator('[data-action="open-goals"]').click();
  const goals = page.locator('.goals');
  await goals.locator('[data-action="goals-tab"][data-page="pass"]').click();
  await expect(goals).toHaveAttribute('data-page', 'pass');
  await expect(goals.locator('.panel__title')).toHaveText('Road Pass');
  const pass = goals.locator('.road-pass');
  await expect(pass.locator('.road-pass__season')).toContainText('Season');
  await expect(pass.locator('.road-pass__progress')).toHaveText('Tier 1: 0 / 60 points');
  await expect(pass.locator('.road-pass__tier')).toHaveCount(20);
  await expect(pass.locator('.road-pass__tier[data-tier="1"] .road-pass__reward-text').first()).toHaveText('1,000 credits');
  // Plus's colours on every fourth tier, locked without it.
  await expect(pass.locator('.road-pass__swatch')).toHaveCount(5);
  await expect(pass.locator('[data-action="claim-pass-plus"]')).toHaveCount(0);
  await testInfo.attach('road pass', { body: await page.screenshot(), contentType: 'image/png' });

  // Bought in the shop: Plus is the company's.
  await pass.locator('[data-action="get-road-pass"]').click();
  await expect(goals).toBeHidden();
  const product = page.locator('.shop__product[data-product="road_pass"]');
  await expect(product.locator('.shop__product-name')).toHaveText('Road Pass Plus');
  await product.locator('[data-action="buy-product"]').click();
  await page.locator('.simulated [data-action="simulated-buy"]').click();
  await expect(page.locator('.toast', { hasText: 'Thank you! Road Pass Plus unlocked.' })).toBeVisible();
  await page.locator('[data-action="close-shop"]').click();
  await page.locator('[data-action="open-goals"]').click();
  await goals.locator('[data-action="goals-tab"][data-page="pass"]').click();
  await expect(pass.locator('.road-pass__plus')).toHaveClass(/is-owned/);
  await expect(pass.locator('[data-action="get-road-pass"]')).toHaveCount(0);
  expect(problems).toEqual([]);
});
