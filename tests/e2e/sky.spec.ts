import { expect, test } from '@playwright/test';
import { openGame, watchForProblems } from './support';

test('lights the northern sky on a clear winter night, points it out and counts it toward the goals', async ({ page }, testInfo) => {
  test.slow(); // The lights fade in over 20 s, drawn in software.
  const problems = watchForProblems(page);
  // Facing north, the lights brought out for the look.
  await openGame(page, '?lang=en&traffic=0&weather=clear&season=winter&time=23:30&sky=aurora&spawn=-1300,600,180');
  await expect(page.locator('.toast', { hasText: 'Northern lights!' })).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.toast', { hasText: 'Sky wonders seen' })).toBeVisible();
  await testInfo.attach('northern lights', { body: await page.screenshot(), contentType: 'image/png' });
  expect(problems).toEqual([]);
});
