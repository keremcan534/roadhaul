import { expect, test } from '@playwright/test';
import { continueGame, openGame, openPanel, watchForProblems } from './support';

test('tunes the cab radio through its stations and off, and keeps the station for the next drive', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  await openGame(page, '?traffic=0&lang=en');
  const radio = page.locator('[data-action="radio"]');
  await expect(radio).toBeVisible();
  await expect(radio).toHaveAttribute('data-station', 'off');

  await radio.click();
  await expect(radio).toHaveAttribute('data-station', 'highway');
  await expect(radio).toHaveClass(/is-on/);
  await expect(page.locator('.toast').filter({ hasText: 'Radio: Highway FM' })).toBeVisible();
  await page.keyboard.press('KeyR'); // R tunes too.
  await expect(radio).toHaveAttribute('data-station', 'night');
  await radio.click();
  await expect(radio).toHaveAttribute('data-station', 'country');

  // Kept on the device: the next drive starts on it.
  await page.reload();
  await continueGame(page);
  await expect(radio).toHaveAttribute('data-station', 'country');
  await radio.click();
  await expect(radio).toHaveAttribute('data-station', 'off');
  await expect(page.locator('.toast').filter({ hasText: 'Radio off' })).toBeVisible();
  // Not in the pause menu.
  await page.locator('.pause-button').click();
  await expect(radio).toBeHidden();
  expect(problems).toEqual([]);
});

test('shows the weekly cup on the rivals\' page: the company and the rivals, the prizes and when it ends', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  await openGame(page, '?traffic=0&lang=en');
  await openPanel(page, 'rivals');
  const cup = page.locator('.hq__section--cup');
  await expect(cup.locator('.hq__section-title')).toHaveText('Weekly cup');
  await expect(cup.locator('.hq__note')).toContainText('Prizes: 1. 15,000 credits + Gold crate');
  await expect(cup.locator('.hq__note')).toContainText('Ends in');
  await expect(cup.locator('.league__row')).toHaveCount(5);
  await expect(cup.locator('.league__row.is-player .league__value')).toHaveText('0 pts');
  expect(problems).toEqual([]);
});

test('sends a convoy ahead when asked, and says how to ride with it', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  await openGame(page, '?traffic=0&spawn=300,-641,84&road=convoy&lang=en&time=12:00&weather=clear');
  await expect(page.locator('.toast').filter({ hasText: 'A convoy is setting off ahead' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.road-alert')).toHaveAttribute('data-alert', /^(convoy|camera|worksAhead|works)$/);
  expect(problems).toEqual([]);
});
