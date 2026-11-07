import { expect, test } from '@playwright/test';
import { openMainMenu, openPanel, savedCompany, watchForProblems } from './support';

test('offers the daily reward as the day’s first drive starts, pays it once, and keeps the streak', async ({ page }) => {
  test.slow(); // The game booted three times, drawn in software.
  const problems = watchForProblems(page);
  await page.addInitScript((json) => {
    if (sessionStorage.getItem('roadhaul.e2e.seeded') === null) {
      localStorage.setItem('roadhaul.save', json);
      sessionStorage.setItem('roadhaul.e2e.seeded', 'yes');
    }
  }, savedCompany({ credits: 30_000 }));
  const html = page.locator('html');
  const dialog = page.locator('.daily');

  // Left for later: the truck waits under it, and the money is untouched.
  await openMainMenu(page, '?lang=en');
  await page.locator('[data-action="continue-game"]').click();
  await expect(html).toHaveAttribute('data-game-state', 'driving');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.daily__day')).toHaveCount(7);
  await expect(dialog.locator('[data-state="today"]')).toHaveAttribute('data-day', '1');
  // A level 2 company: day 1's 300 credits, and half as much again.
  await expect(dialog.locator('[data-action="claim-daily"]')).toHaveText('Collect 450 credits');
  await dialog.locator('[data-action="later-daily"]').click();
  await expect(dialog).toBeHidden();
  await openPanel(page, 'jobs');
  await expect(page.locator('.hq__credits')).toHaveText('30,000 credits');

  // The game started again: offered again, and collected.
  await page.reload();
  await expect(html).toHaveAttribute('data-game-state', 'mainMenu');
  await page.locator('[data-action="continue-game"]').click();
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-action="claim-daily"]').click();
  await expect(dialog.locator('[data-value="collected"]')).toHaveText('+450 credits');
  await expect(dialog.locator('[data-state="claimed"]')).toHaveAttribute('data-day', '1');
  await dialog.locator('[data-action="close-daily"]').click();
  await expect(dialog).toBeHidden();
  await openPanel(page, 'jobs');
  await expect(page.locator('.hq__credits')).toHaveText('30,450 credits');

  // The same day again: nothing more.
  await page.reload();
  await expect(html).toHaveAttribute('data-game-state', 'mainMenu');
  await page.locator('[data-action="continue-game"]').click();
  await expect(html).toHaveAttribute('data-game-state', 'driving');
  await expect(page.locator('.hud-dock')).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(problems).toEqual([]);
});
