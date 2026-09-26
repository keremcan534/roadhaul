import { expect, test, type Page } from '@playwright/test';
import {
  closePanel,
  foundCompany,
  openCompanyHq,
  openGame,
  openMainMenu,
  openPanel,
  shownSpeed,
  takeContract,
  waitForFrames,
  watchForProblems,
} from './support';

const html = (page: Page) => page.locator('html');

/** Drives forward briefly, like pulling out of a bay. */
async function pullAway(page: Page): Promise<void> {
  await page.keyboard.down('ArrowUp');
  await expect(html(page)).toHaveAttribute('data-mission-state', 'delivering', { timeout: 10_000 });
  await page.keyboard.up('ArrowUp');
}

test('boots into the main menu, goes straight into the game, and opens the job board from its button', async ({ page }) => {
  const problems = watchForProblems(page);
  await openMainMenu(page, '?lang=en');

  await expect(page.locator('.main-menu__logo')).toBeVisible();
  await expect(page.locator('.touch-controls')).toBeHidden();
  await expect(page.locator('[data-action="continue-game"]')).toBeHidden(); // Nothing saved yet.
  await foundCompany(page, 'Kuzey Lojistik');

  // On the road at once, the truck under the player's hands, the company's pages a tap away.
  await expect(page.locator('.touch-controls')).toBeVisible();
  await expect(page.locator('.hq')).toBeHidden();
  await expect(page.locator('.hud-dock')).toBeVisible();
  await expect(page.locator('[data-action="dock-jobs"]')).toHaveText('Jobs');
  await page.locator('[data-action="dock-jobs"]').click();
  await expect(html(page)).toHaveAttribute('data-panel', 'open');
  await expect(page.locator('.touch-controls')).toBeHidden();

  await expect(page.locator('.hq__company-name')).toHaveText('Kuzey Lojistik');
  await expect(page.locator('.hq__credits')).toHaveText('5,000 credits');
  await expect(page.locator('.hq__level')).toHaveText('Level 1 · Rookie');
  // The game's own twenty, and five contracts of the day.
  const own = page.locator('.job-card:not(.job-card--daily)');
  await expect(own).toHaveCount(20);
  await expect(page.locator('.job-card--daily')).toHaveCount(5);
  // Six need a higher company level; the other ten also need a bigger truck.
  await expect(page.locator('.job-card.is-locked:not(.job-card--daily)')).toHaveCount(16);
  const first = own.first();
  await expect(first.locator('.job-card__title')).toHaveText('First Package');
  await expect(first.locator('.job-card__route')).toHaveText('Yeniliman → Demirkent');
  await expect(first.locator('.job-card__pay')).toHaveText('900 credits');
  expect(problems).toEqual([]);
});

test('speaks Turkish when asked to', async ({ page }) => {
  await openMainMenu(page, '?lang=tr');

  await expect(html(page)).toHaveAttribute('lang', 'tr');
  await expect(page.locator('[data-action="new-company"]')).toHaveText('Yeni şirket');
});

test('delivers a contract from the pickup bay to the delivery bay', async ({ page }, testInfo) => {
  test.slow();
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
  const total = Number((await result.locator('.result-dialog__line.is-total dd').textContent())!.replace(/\D/g, ''));
  expect(total).toBeGreaterThan(900);
  await expect(result.locator('.result-dialog__line.is-progress').first()).toContainText('XP');
  await expect(result.locator('.result-dialog__line').last()).toContainText(`${(5000 + total).toLocaleString('en-GB')} credits`);
  await testInfo.attach('result', { body: await page.screenshot(), contentType: 'image/png' });

  // Straight on to the next job.
  await result.locator('[data-action="result-jobs"]').click();
  await expect(html(page)).toHaveAttribute('data-game-state', 'driving');
  await expect(html(page)).toHaveAttribute('data-panel', 'open');
  await expect(page.locator('.hq__tab[data-tab="jobs"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.hq__credits')).toHaveText(`${(5000 + total).toLocaleString('en-GB')} credits`);
  await expect(page.locator('.job-card')).toHaveCount(25);
  // The truck waits in the delivery depot's yard, where it can be serviced.
  await openPanel(page, 'truck');
  await expect(page.locator('.hq__truck-location')).toHaveText('At Demirkent depot');
  await expect(page.locator('.hq__service-note')).toBeHidden();
  expect(problems).toEqual([]);
});

test('offers contracts of the day, and keeps one under way across a reload', async ({ page }, testInfo) => {
  test.slow();
  const problems = watchForProblems(page);
  await openCompanyHq(page, '?debug&lang=en');

  // Five from the generator, the two easy ones first on the board; the rest wait for a level.
  await expect(page.locator('.job-card--daily')).toHaveCount(5);
  await expect(page.locator('.job-card').first()).toHaveClass(/job-card--daily/);
  await expect(page.locator('.hq__list[data-tab="jobs"] .hq__note')).toContainText(
    'Contracts of the day change every 6 hours',
  );
  const open = page.locator('.job-card--daily:not(.is-locked)');
  await expect(open).toHaveCount(2);
  const card = open.first();
  await expect(card.locator('.badge--daily')).toHaveText('Today');
  await expect(card.locator('.job-card__title')).toHaveText(/ delivery$/);
  expect(await card.getAttribute('data-mission-id')).toMatch(/^daily_\d+_1$/);
  await testInfo.attach('contracts of the day', { body: await page.screenshot(), contentType: 'image/png' });
  await card.locator('[data-action="accept"]').click();
  await expect(html(page)).toHaveAttribute('data-game-state', 'driving');
  await page.keyboard.press('KeyT');
  await expect(html(page)).toHaveAttribute('data-mission-state', 'loaded', { timeout: 15_000 });

  // The save keeps the contract itself, whatever the board deals next.
  await page.reload();
  await expect(html(page)).toHaveAttribute('data-game-state', 'mainMenu');
  await page.locator('[data-action="continue-game"]').click();
  await expect(html(page)).toHaveAttribute('data-mission-state', 'loaded');
  await expect(html(page)).toHaveAttribute('data-game-state', 'driving');
  await expect(page.locator('.mission-hud__objective')).toContainText('Deliver to');

  await pullAway(page);
  await page.keyboard.press('KeyT');
  const result = page.locator('.result-dialog');
  await expect(result).toBeVisible({ timeout: 15_000 });
  await expect(result.locator('.panel__title')).toHaveText('Delivered!');
  await expect(result.locator('.result-dialog__mission')).toContainText(' delivery · ');
  expect(problems).toEqual([]);
});

test('abandoning a contract from the pause menu fails it, and the road is back with the job board', async ({ page }) => {
  const problems = watchForProblems(page);
  await openCompanyHq(page, '?lang=en');
  await takeContract(page, 'market_shipment');
  // Under way: no job board button, the others shrink out of the mission HUD's way.
  await expect(page.locator('[data-action="dock-jobs"]')).toBeHidden();
  await expect(page.locator('.hud-dock')).toHaveAttribute('data-mode', 'compact');

  await page.locator('[data-action="pause"]').click();
  const pause = page.locator('.pause-menu');
  await expect(pause).toBeVisible();
  await expect(pause.locator('[data-action="pause-main-menu"]')).toBeVisible();
  await pause.locator('[data-action="abandon"]').click();

  const result = page.locator('.result-dialog');
  await expect(result.locator('.panel__title')).toHaveText('Contract failed');
  await expect(result.locator('.result-dialog__reason')).toHaveText('You abandoned the contract.');
  await result.locator('[data-action="continue"]').click();
  await expect(html(page)).toHaveAttribute('data-game-state', 'driving');
  await expect(html(page)).toHaveAttribute('data-panel', 'none');
  await expect(page.locator('[data-action="dock-jobs"]')).toBeVisible();
  await expect(page.locator('.pause-button')).toBeVisible();
  expect(problems).toEqual([]);
});

test('pausing stops the truck, and Escape resumes', async ({ page }) => {
  await openGame(page, '?lang=en');
  // As the driving tests do: past the first frames on the road (drawn in software, they build the shaders and the
  // simulation loses the time they take), and time enough to speed up.
  await waitForFrames(page, 5);
  await page.keyboard.down('ArrowUp');
  await expect.poll(() => shownSpeed(page), { timeout: 20_000 }).toBeGreaterThan(10);

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

test('pauses the drive when the player leaves the game: another tab, or the app sent to the background', async ({
  page,
}) => {
  const problems = watchForProblems(page);
  await openGame(page, '?lang=en');
  await expect(page.locator('.pause-menu')).toBeHidden();

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await expect(page.locator('.pause-menu')).toBeVisible();
  expect(problems).toEqual([]);
});

test('keeps the mission HUD clear of the buttons and its text whole in both orientations', async ({ page }) => {
  test.slow();
  /** True when a text is cut off with an ellipsis. */
  const truncated = (selector: string) =>
    page.locator(selector).evaluate((element) => element.scrollWidth > element.clientWidth + 1);
  for (const size of [
    { width: 863, height: 360 },
    { width: 412, height: 839 },
  ]) {
    await page.setViewportSize(size);
    await openCompanyHq(page, '?debug&lang=tr');
    // A long objective: the pickup at Başakova (open at level 1).
    await takeContract(page, 'farm_harvest');
    await expect(page.locator('.mission-hud')).toBeVisible();

    const hud = (await page.locator('.mission-hud').boundingBox())!;
    for (const selector of [
      '.pause-button',
      '.camera-button',
      '.horn-button',
      '.dashboard',
      '.steering-wheel',
      '.pedals',
      '.minimap',
      '.hud-dock',
    ]) {
      const box = (await page.locator(selector).boundingBox())!;
      const overlap =
        hud.x < box.x + box.width && box.x < hud.x + hud.width && hud.y < box.y + box.height && box.y < hud.y + hud.height;
      expect(overlap, `${size.width}×${size.height}: the HUD overlaps ${selector}`).toBe(false);
    }
    expect(hud.x).toBeGreaterThanOrEqual(0);
    expect(hud.x + hud.width).toBeLessThanOrEqual(size.width);
    expect(await truncated('.mission-hud__objective'), `${size.width}×${size.height}: pickup objective`).toBe(false);

    await page.keyboard.press('KeyT');
    await expect(html(page)).toHaveAttribute('data-mission-state', 'loaded', { timeout: 15_000 });
    await expect(page.locator('.mission-hud__objective')).toContainText('Yeniliman');
    expect(await truncated('.mission-hud__objective'), `${size.width}×${size.height}: delivery objective`).toBe(false);
    // Parked at the delivery bay before driving off: the (long) stop-to-unload hint shows.
    await page.keyboard.press('KeyT');
    await expect(page.locator('.mission-hud__hint')).toBeVisible();
    expect(await truncated('.mission-hud__hint'), `${size.width}×${size.height}: stop hint`).toBe(false);
  }
});

test('continues the saved company after the page reloads', async ({ page }) => {
  test.slow(); // The game started twice, drawn in software.
  const problems = watchForProblems(page);
  await openCompanyHq(page, '?lang=en');
  await takeContract(page, 'first_package');
  await page.locator('[data-action="pause"]').click();
  await page.locator('.pause-menu [data-action="abandon"]').click();
  await page.locator('.result-dialog [data-action="continue"]').click();
  await expect(html(page)).toHaveAttribute('data-game-state', 'driving');

  await page.reload();
  await expect(html(page)).toHaveAttribute('data-game-state', 'mainMenu');
  await page.locator('[data-action="continue-game"]').click();

  await expect(html(page)).toHaveAttribute('data-game-state', 'driving');
  await openPanel(page, 'jobs');
  await expect(page.locator('.hq__company-name')).toHaveText('Test Lojistik');
  await expect(page.locator('.hq__credits')).toHaveText('5,000 credits');
  expect(problems).toEqual([]);
});

test('checks the company name before founding it', async ({ page }) => {
  await openMainMenu(page, '?lang=en');
  await page.locator('[data-action="new-company"]').click();
  await page.locator('.new-company__input').fill(' ');
  await page.locator('[data-action="start-company"]').click();

  await expect(page.locator('.new-company__error')).toHaveText('Use at least 2 characters.');
  await expect(html(page)).toHaveAttribute('data-game-state', 'mainMenu');

  // Typing W, A, S, D and spaces must not drive or pause anything.
  await page.locator('.new-company__input').fill('');
  await page.locator('.new-company__input').pressSequentially('Wasd Paws');
  await expect(page.locator('.new-company__input')).toHaveValue('Wasd Paws');
});

/**
 * Drives until the fuel gauge drops from a full tank. It waits for the gauge
 * to show the full tank first: until the dashboard's first frame on the road
 * it still shows what it showed before the company started (an empty tank).
 */
async function driveUntilFuelBurns(page: Page): Promise<void> {
  const gauge = page.locator('.dashboard__gauge--fuel');
  await expect(gauge).toHaveAttribute('data-percent', '100');
  await page.keyboard.down('ArrowUp');
  await expect.poll(async () => Number(await gauge.getAttribute('data-percent')), { timeout: 30_000 }).toBeLessThan(100);
  await page.keyboard.up('ArrowUp');
}

test('burns fuel while driving, and refuels only at a depot or rest area', async ({ page }) => {
  test.slow(); // It drives until the gauge moves (up to 30 s, drawn in software), then stops twice.
  const problems = watchForProblems(page);
  // fuelScale burns fuel as fast as the old test track did, so the gauge moves within seconds.
  await openGame(page, '?lang=en&debug&fuelScale=60');
  await openPanel(page, 'truck');
  await expect(page.locator('[data-action="refuel"]')).toHaveText('Tank full');
  await expect(page.locator('[data-action="refuel"]')).toBeDisabled();

  await closePanel(page);
  await driveUntilFuelBurns(page);

  // Out on the road there is no pump: the truck page says where to go.
  await page.locator('[data-action="dock-truck"]').click();
  const refuel = page.locator('[data-action="refuel"]');
  await expect(page.locator('.hq__truck-location')).toHaveText('On the road');
  await expect(refuel).toBeDisabled();
  await expect(page.locator('.hq__service-note')).toBeVisible();

  // Parked at the rest area (debug Y), it can fill up.
  await closePanel(page);
  await page.keyboard.press('KeyY');
  await page.locator('[data-action="dock-truck"]').click();
  await expect(page.locator('.hq__truck-location')).toHaveText('At the rest area');
  await expect(page.locator('.hq__service-note')).toBeHidden();
  await expect(refuel).toBeEnabled();
  await expect(refuel).toContainText('Refuel');
  await refuel.click();
  await expect(page.locator('.toast')).toContainText('Refuelled');
  await expect(refuel).toHaveText('Tank full');
  expect(problems).toEqual([]);
});

test('offers fuel, repairs and the road again at the rest area', async ({ page }) => {
  test.slow(); // It drives until the gauge moves (up to 30 s, drawn in software), then stops.
  const problems = watchForProblems(page);
  await openGame(page, '?lang=en&debug&fuelScale=60');
  await driveUntilFuelBurns(page);

  // Debug Y parks the truck on the rest area's lot.
  await page.keyboard.press('KeyY');
  const counter = page.locator('.rest-area-panel');
  await expect(counter).toBeVisible();
  await expect(counter).toContainText('Rest area');
  await expect(counter.locator('[data-action="rest-repair"]')).toBeDisabled(); // No damage.
  await counter.locator('[data-action="rest-refuel"]').click();
  await expect(page.locator('.toast')).toContainText('Refuelled');
  await expect(counter.locator('[data-action="rest-refuel"]')).toHaveText('Tank full');

  await counter.locator('[data-action="rest-continue"]').click();
  await expect(counter).toBeHidden();
  // It stays closed while the truck is still on the lot.
  await page.keyboard.press('KeyY');
  await expect(counter).toBeHidden();
  expect(problems).toEqual([]);
});
