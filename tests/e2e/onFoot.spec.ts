import { expect, test } from '@playwright/test';
import { OPEN_ROAD, openGame, watchForProblems } from './support';

test('gets out of the truck standing still, walks round it on foot, and gets back in at the cab door', async ({ page }) => {
  const problems = watchForProblems(page);
  await openGame(page, `${OPEN_ROAD}&lang=en`);
  const html = page.locator('html');
  const button = page.locator('[data-action="on-foot"]');
  await expect(button).toHaveAttribute('data-state', 'out');
  await expect(button).toHaveText('Get out');

  await button.click();
  await expect(html).toHaveAttribute('data-on-foot', 'on');
  await expect(page.locator('.toast').filter({ hasText: 'On foot:' })).toBeVisible();
  // At the door: back in at once is offered.
  await expect(button).toHaveAttribute('data-state', 'in');

  // A few seconds' walk ahead: too far from the door now.
  await page.keyboard.down('ArrowUp');
  await expect(button).toHaveAttribute('data-state', 'walkBack', { timeout: 10_000 });
  await expect(button).toBeDisabled();
  await page.keyboard.up('ArrowUp');
  // Back again, the same way, to the door; in with Enter.
  await page.keyboard.down('ArrowDown');
  await expect(button).toHaveAttribute('data-state', 'in', { timeout: 15_000 });
  await page.keyboard.up('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(html).toHaveAttribute('data-on-foot', 'off');
  await expect(button).toHaveAttribute('data-state', 'out');
  expect(problems).toEqual([]);
});

test('will not get out of a moving truck', async ({ page }) => {
  await openGame(page, `${OPEN_ROAD}&lang=en`);
  const button = page.locator('[data-action="on-foot"]');
  await expect(button).toHaveAttribute('data-state', 'out');
  // Moving off: the button goes.
  await page.keyboard.down('ArrowUp');
  await expect(button).toBeHidden({ timeout: 10_000 });
  await page.keyboard.press('Enter');
  await expect(page.locator('.toast').filter({ hasText: 'Stop the truck to get out.' })).toBeVisible();
  await page.keyboard.up('ArrowUp');
  await expect(page.locator('html')).not.toHaveAttribute('data-on-foot', 'on');
});
