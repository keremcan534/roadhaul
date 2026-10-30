import { expect, test } from '@playwright/test';
import { continueSavedCompany, openPanel, savedCompany, watchForProblems } from './support';

test('counts the company’s goals from its save, and pays a reached one once collected', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  // Nine deliveries and level 2: the first delivery's goal and level 2's are reached already.
  await continueSavedCompany(page, savedCompany({ credits: 30_000 }), '?lang=en');
  await openPanel(page, 'jobs');
  const badge = page.locator('[data-value="goals-waiting"]');
  await expect(badge).toHaveText('2');
  await page.locator('[data-action="open-goals"]').click();
  const goals = page.locator('.goals');
  await expect(goals).toBeVisible();
  // To collect first.
  await expect(goals.locator('.goals__card').first()).toHaveAttribute('data-state', 'reached');
  await expect(goals.locator('[data-action="claim-goal"]')).toHaveCount(2);
  const deliveries = goals.locator('[data-goal="deliveries_10"]');
  await expect(deliveries.locator('.goals__progress')).toHaveText('9 / 10');

  await goals.locator('[data-goal="deliveries_1"] [data-action="claim-goal"]').click();
  await expect(goals.locator('[data-goal="deliveries_1"]')).toHaveAttribute('data-state', 'claimed');
  await expect(goals.locator('[data-action="claim-goal"]')).toHaveCount(1);
  await expect(badge).toHaveText('1');
  await goals.locator('[data-action="close-goals"]').click();
  await expect(goals).toBeHidden();
  await expect(page.locator('.hq__credits')).toHaveText('30,500 credits');
  expect(problems).toEqual([]);
});
