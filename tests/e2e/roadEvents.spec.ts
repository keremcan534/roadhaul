import { expect, test } from '@playwright/test';
import { openGame, watchForProblems } from './support';

/** 200 m short of the highway's speed camera east of Havenport, in the right-hand lane, heading for it. */
const BEFORE_CAMERA = '?traffic=0&spawn=-972.0,-384.9,116.8';

test('shows the speed camera ahead with its limit and how far it is, and the camera on its post', async ({ page }, testInfo) => {
  test.slow();
  const problems = watchForProblems(page);
  await openGame(page, `${BEFORE_CAMERA}&lang=en&time=12:00&weather=clear`);

  const alert = page.locator('.road-alert');
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute('data-alert', 'camera');
  await expect(alert.locator('.road-alert__limit')).toHaveText('90');
  await expect(alert.locator('.road-alert__label')).toHaveText('200 m');
  await testInfo.attach('camera ahead', { body: await page.screenshot(), contentType: 'image/png' });

  // In the pause menu the alert goes with the rest of the road's display.
  await page.locator('.pause-button').click();
  await expect(alert).toBeHidden();
  await page.locator('[data-action="resume"]').click();
  await expect(alert).toBeVisible();
  expect(problems).toEqual([]);
});

test('sends a stranded driver ahead when asked, and says where to stop', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  await openGame(page, '?traffic=0&spawn=300,-641,84&road=stranded&lang=en&time=12:00&weather=clear');

  await expect(page.locator('html')).toHaveAttribute('data-stranded', 'waiting', { timeout: 15_000 });
  await expect(page.locator('.toast').filter({ hasText: 'A driver is stranded ahead' })).toBeVisible();
  expect(problems).toEqual([]);
});
