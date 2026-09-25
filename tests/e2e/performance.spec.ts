import { expect, test, type Page } from '@playwright/test';
import { openCompanyHq, openGame, openMainMenu, takeContract, waitForFrames, watchForProblems } from './support';

/** Draw calls and triangles of the last frame, from the `?debug` overlay. */
async function renderCost(page: Page): Promise<{ draws: number; triangles: number }> {
  const text = (await page.locator('.perf-overlay').textContent()) ?? '';
  return {
    draws: Number(/(\d+) draws/.exec(text)?.[1] ?? Number.NaN),
    triangles: Number(/(\d+) tris/.exec(text)?.[1] ?? Number.NaN),
  };
}

test('keeps a busy city scene at night in the rain within the draw budget', async ({ page }, testInfo) => {
  test.setTimeout(60_000); // The game started twice, drawn in software.
  const problems = watchForProblems(page);
  // The most there is to draw: dense traffic, lit lamps and glows, the headlights, and rain.
  // Parked in the pickup bay, in Yeniliman's yard, among its buildings. The lamps light the world here, drawn in
  // software too (?lamps=1), so their shaders compile and draw without a problem.
  await openCompanyHq(page, '?debug&lang=en&traffic=24&weather=night&lamps=1');
  await takeContract(page, 'first_package');
  await page.keyboard.press('KeyT');
  await waitForFrames(page, 20);
  const night = await renderCost(page);
  await testInfo.attach('night', { body: await page.screenshot(), contentType: 'image/png' });
  await openGame(page, '?debug&lang=en&traffic=24&weather=rain&lamps=1');
  await waitForFrames(page, 20);
  const rain = await renderCost(page);

  // ARCHITECTURE.md §11: at most ~150 draw calls and ~300k triangles in view.
  for (const cost of [night, rain]) {
    expect(cost.draws).toBeGreaterThan(20);
    expect(cost.draws).toBeLessThanOrEqual(150);
    expect(cost.triangles).toBeLessThanOrEqual(300_000);
  }
  expect(problems).toEqual([]);
});

test('lets the player pick the graphics preset, and keeps it', async ({ page }) => {
  const problems = watchForProblems(page);
  const html = page.locator('html');
  await openMainMenu(page, '?lang=en&quality=');
  await expect(html).not.toHaveAttribute('data-quality', '');

  await page.locator('[data-action="settings"]').click();
  const settings = page.locator('.settings');
  await expect(settings).toBeVisible();
  await expect(settings.locator('[data-quality="auto"]')).toHaveAttribute('aria-checked', 'true');
  await settings.locator('[data-quality="low"]').click();

  // The game restarts with the low preset: fewer pixels, less traffic.
  await expect(html).toHaveAttribute('data-quality', 'low');
  await expect(html).toHaveAttribute('data-boot-state', 'ready');
  await expect.poll(async () => Number(await html.getAttribute('data-traffic')), { timeout: 15_000 }).toBe(8);
  await page.locator('[data-action="settings"]').click();
  await expect(page.locator('.settings [data-quality="low"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('[data-action="close-settings"]').click();
  await expect(page.locator('.settings')).toBeHidden();
  expect(problems).toEqual([]);
});

test('switches the performance display on from Settings, naming the preset and GPU, and keeps it', async ({ page }) => {
  const problems = watchForProblems(page);
  const overlay = page.locator('.perf-overlay');
  await openMainMenu(page, '?lang=en');
  await expect(overlay).toBeHidden();

  await page.locator('[data-action="settings"]').click();
  await expect(page.locator('.settings [data-stats="off"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('.settings [data-stats="on"]').click();
  await page.locator('[data-action="close-settings"]').click();
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText(/\d+ FPS · \d+ draws/);
  // The tests play on the high preset; the GPU follows it.
  await expect(overlay).toContainText(/high · \S+/);

  // Kept on this device, and off again at once.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-boot-state', 'ready');
  await expect(overlay).toBeVisible();
  await page.locator('[data-action="settings"]').click();
  await page.locator('.settings [data-stats="off"]').click();
  await expect(overlay).toBeHidden();
  expect(problems).toEqual([]);
});
