import { expect, test } from '@playwright/test';
import { openCompanyHq, openGame, openMainMenu, takeContract, waitForFrames, watchForProblems } from './support';

test('starts the sound at the first touch, and lets the player switch it off on this device', async ({ page }) => {
  const problems = watchForProblems(page);
  const html = page.locator('html');
  await openMainMenu(page, '?lang=en');
  // Browsers allow sound only after the page is touched.
  await expect(html).toHaveAttribute('data-sound', 'waiting');

  await page.locator('[data-action="settings"]').click();
  await expect(html).toHaveAttribute('data-sound', 'on');
  const settings = page.locator('.settings');
  await expect(settings.locator('[data-sound="on"]')).toHaveAttribute('aria-checked', 'true');
  await settings.locator('[data-sound="off"]').click();
  await expect(html).toHaveAttribute('data-sound', 'off');
  await expect(settings.locator('[data-sound="off"]')).toHaveAttribute('aria-checked', 'true');
  await expect(settings.locator('[data-sound="on"]')).toHaveAttribute('aria-checked', 'false');

  // Kept on this device, and on again at once.
  await page.reload();
  await expect(html).toHaveAttribute('data-boot-state', 'ready');
  await expect(html).toHaveAttribute('data-sound', 'off');
  await page.locator('[data-action="settings"]').click();
  await expect(settings.locator('[data-sound="off"]')).toHaveAttribute('aria-checked', 'true');
  await settings.locator('[data-sound="on"]').click();
  await expect(html).toHaveAttribute('data-sound', 'on');
  expect(problems).toEqual([]);
});

test('drives a contract with the engine, brakes, horn and rain sounding, without an error', async ({ page }) => {
  test.setTimeout(60_000);
  const problems = watchForProblems(page);
  const html = page.locator('html');
  await openCompanyHq(page, '?debug&lang=en&weather=rain');
  await expect(html).toHaveAttribute('data-sound', 'on');
  await takeContract(page, 'first_package');

  await page.keyboard.down('ArrowUp');
  await page.keyboard.down('KeyH');
  await waitForFrames(page, 30);
  await page.keyboard.up('KeyH');
  await page.keyboard.up('ArrowUp');
  await page.keyboard.down('Space');
  await waitForFrames(page, 30);
  await page.keyboard.up('Space');
  await page.locator('.horn-button').dispatchEvent('pointerdown', { pointerId: 7 });
  await waitForFrames(page, 10);
  await page.locator('.horn-button').dispatchEvent('pointerup', { pointerId: 7 });
  // Loading in the bay clunks.
  await page.keyboard.press('KeyT');
  await expect(html).toHaveAttribute('data-mission-state', 'loaded', { timeout: 15_000 });
  await expect(html).toHaveAttribute('data-sound', 'on');
  expect(problems).toEqual([]);
});

test('stays silent, and quiet about it, where the browser has no Web Audio', async ({ page }) => {
  const problems = watchForProblems(page);
  await page.addInitScript(() => {
    // An old WebView: no AudioContext at all.
    Reflect.deleteProperty(window, 'AudioContext');
  });
  await openGame(page, '?lang=en');
  await page.keyboard.down('ArrowUp');
  await waitForFrames(page, 20);
  await page.keyboard.up('ArrowUp');

  await expect(page.locator('html')).toHaveAttribute('data-sound', 'waiting');
  expect(problems).toEqual([]);
});
