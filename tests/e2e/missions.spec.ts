import { expect, test, type Page } from '@playwright/test';
import { openCompanyHq, openMainMenu, watchForProblems } from './support';

const html = (page: Page) => page.locator('html');

/** Takes a contract from the job board by its mission id. */
async function takeContract(page: Page, missionId: string): Promise<void> {
  await page.locator(`.job-card[data-mission-id="${missionId}"] [data-action="accept"]`).click();
  await expect(html(page)).toHaveAttribute('data-game-state', 'driving');
}

/** Drives forward briefly, like pulling out of a bay. */
async function pullAway(page: Page): Promise<void> {
  await page.keyboard.down('ArrowUp');
  await expect(html(page)).toHaveAttribute('data-mission-state', 'delivering', { timeout: 10_000 });
  await page.keyboard.up('ArrowUp');
}

test('boots into the main menu and opens the job board', async ({ page }) => {
  const problems = watchForProblems(page);
  await openMainMenu(page, '?lang=en');

  await expect(page.locator('.main-menu__logo')).toBeVisible();
  await expect(page.locator('.touch-controls')).toBeHidden();
  await page.locator('[data-action="play"]').click();

  await expect(html(page)).toHaveAttribute('data-game-state', 'companyHq');
  await expect(page.locator('.job-card')).toHaveCount(10);
  const first = page.locator('.job-card').first();
  await expect(first.locator('.job-card__title')).toHaveText('First Package');
  await expect(first.locator('.job-card__route')).toHaveText('Yeniliman → Demirkent');
  await expect(first.locator('.job-card__pay')).toHaveText('900 credits');
  expect(problems).toEqual([]);
});

test('speaks Turkish when asked to', async ({ page }) => {
  await openMainMenu(page, '?lang=tr');

  await expect(html(page)).toHaveAttribute('lang', 'tr');
  await expect(page.locator('[data-action="play"]')).toHaveText('Oyna');
});

test('delivers a contract from the pickup bay to the delivery bay', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const problems = watchForProblems(page);
  await openCompanyHq(page, '?debug&lang=en');
  await takeContract(page, 'first_package');

  const hud = page.locator('.mission-hud');
  await expect(hud).toBeVisible();
  await expect(page.locator('.mission-hud__objective')).toHaveText('Pick up at Yeniliman depot');
  await expect(html(page)).toHaveAttribute('data-mission-state', 'travellingToPickup');

  // Debug key: park in the bay the mission needs next. Loading takes 3 s of standing still.
  await page.keyboard.press('KeyT');
  await expect(page.locator('.mission-hud__hint')).toHaveText('Loading…');
  await expect(html(page)).toHaveAttribute('data-mission-state', 'loaded', { timeout: 15_000 });
  await expect(page.locator('.mission-hud__objective')).toHaveText('Deliver to Demirkent depot');
  await expect(page.locator('.mission-hud__cargo')).toHaveText('Cargo 100%');
  await testInfo.attach('loaded', { body: await page.screenshot(), contentType: 'image/png' });

  await pullAway(page);
  await page.keyboard.press('KeyT');
  await expect(page.locator('.mission-hud__hint')).toHaveText('Unloading…');

  const result = page.locator('.result-dialog');
  await expect(result).toBeVisible({ timeout: 15_000 });
  await expect(html(page)).toHaveAttribute('data-mission-state', 'completed');
  await expect(result.locator('.panel__title')).toHaveText('Delivered!');
  await expect(result.locator('.result-dialog__line.is-total dd')).toContainText('credits');
  await testInfo.attach('result', { body: await page.screenshot(), contentType: 'image/png' });

  await result.locator('[data-action="continue"]').click();
  await expect(html(page)).toHaveAttribute('data-game-state', 'companyHq');
  await expect(page.locator('.job-card')).toHaveCount(10);
  expect(problems).toEqual([]);
});

test('abandoning a contract from the pause menu fails it and returns to the HQ', async ({ page }) => {
  const problems = watchForProblems(page);
  await openCompanyHq(page, '?lang=en');
  await takeContract(page, 'market_shipment');

  await page.locator('[data-action="pause"]').click();
  const pause = page.locator('.pause-menu');
  await expect(pause).toBeVisible();
  await expect(pause.locator('[data-action="company-hq"]')).toBeHidden();
  await pause.locator('[data-action="abandon"]').click();

  const result = page.locator('.result-dialog');
  await expect(result.locator('.panel__title')).toHaveText('Contract failed');
  await expect(result.locator('.result-dialog__reason')).toHaveText('You abandoned the contract.');
  await result.locator('[data-action="continue"]').click();
  await expect(html(page)).toHaveAttribute('data-game-state', 'companyHq');
  expect(problems).toEqual([]);
});

test('pausing stops the truck, and Escape resumes', async ({ page }) => {
  await openCompanyHq(page, '?lang=en');
  await page.locator('[data-action="free-drive"]').click();
  await page.keyboard.down('ArrowUp');
  await expect.poll(async () => Number(await page.locator('.dashboard__speed').textContent())).toBeGreaterThan(10);

  await page.keyboard.press('Escape');
  await page.keyboard.up('ArrowUp');
  await expect(page.locator('.pause-menu')).toBeVisible();
  const frozen = await page.locator('.dashboard__speed').textContent();
  await page.waitForTimeout(500);
  await expect(page.locator('.dashboard__speed')).toHaveText(frozen!);

  await page.keyboard.press('Escape');
  await expect(page.locator('.pause-menu')).toBeHidden();
  await expect.poll(async () => page.locator('.dashboard__speed').textContent()).not.toBe(frozen);
});

test('keeps the mission HUD clear of the buttons in both orientations', async ({ page }) => {
  for (const size of [
    { width: 863, height: 360 },
    { width: 412, height: 839 },
  ]) {
    await page.setViewportSize(size);
    await openCompanyHq(page, '?lang=tr');
    await takeContract(page, 'first_package');
    await expect(page.locator('.mission-hud')).toBeVisible();

    const hud = (await page.locator('.mission-hud').boundingBox())!;
    for (const selector of ['.pause-button', '.camera-button', '.dashboard', '.steering-wheel', '.pedals']) {
      const box = (await page.locator(selector).boundingBox())!;
      const overlap =
        hud.x < box.x + box.width && box.x < hud.x + hud.width && hud.y < box.y + box.height && box.y < hud.y + hud.height;
      expect(overlap, `${size.width}×${size.height}: the HUD overlaps ${selector}`).toBe(false);
    }
    expect(hud.x).toBeGreaterThanOrEqual(0);
    expect(hud.x + hud.width).toBeLessThanOrEqual(size.width);
  }
});
