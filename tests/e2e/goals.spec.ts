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

test('shows the career beside the goals: the company’s record, in groups, its favourites waiting for a delivery', async ({ page }, testInfo) => {
  test.slow();
  const problems = watchForProblems(page);
  // An older save: its deliveries, distance and earnings kept, the career's own records starting now.
  await continueSavedCompany(page, savedCompany({ credits: 30_000 }), '?lang=en');
  await openPanel(page, 'jobs');
  await page.locator('[data-action="open-goals"]').click();
  const goals = page.locator('.goals');
  await expect(goals).toHaveAttribute('data-page', 'goals');

  await goals.locator('[data-action="goals-tab"][data-page="career"]').click();
  await expect(goals).toHaveAttribute('data-page', 'career');
  await expect(goals.locator('.panel__title')).toHaveText('Career');
  await expect(goals.locator('.goals__card').first()).toBeHidden();
  const career = goals.locator('.career');
  await expect(career.locator('.career__group')).toHaveCount(5);
  const value = (stat: string) => career.locator(`[data-stat="${stat}"] .career__value`);
  await expect(value('deliveries')).toHaveText('9');
  await expect(value('distance')).toHaveText('9.0 km');
  await expect(value('earned')).toHaveText('12,000 credits');
  await expect(value('tons')).toHaveText('0 t');
  await expect(value('favouriteCargo')).toHaveText('None yet');
  await expect(career.locator('[data-stat="topSpeed"] .career__label')).toHaveText('Top speed');
  await testInfo.attach('career', { body: await page.screenshot(), contentType: 'image/png' });

  // Opened again, it starts on the goals.
  await goals.locator('[data-action="close-goals"]').click();
  await page.locator('[data-action="open-goals"]').click();
  await expect(goals).toHaveAttribute('data-page', 'goals');
  await expect(goals.locator('.goals__card').first()).toBeVisible();
  expect(problems).toEqual([]);
});
