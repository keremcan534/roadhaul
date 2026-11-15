import { expect, test, type Page } from '@playwright/test';
import { OPEN_ROAD, openGame, openPanel, shownSpeed, takeContract, watchForProblems } from './support';

const html = (page: Page) => page.locator('html');

test('auto-drive takes the wheel along the route, the tablet passes the time, and a firm touch takes it back', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  // Unlocked for the test (it is earned in research), on the open road.
  await openGame(page, `${OPEN_ROAD}&lang=en&autodrive=1`);
  await openPanel(page, 'jobs');
  await takeContract(page, 'market_shipment');

  const autoButton = page.locator('[data-action="auto-drive"]');
  await expect(autoButton).toBeVisible();
  await expect(autoButton).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-action="tablet"]')).toBeHidden();
  await page.keyboard.press('KeyV');
  await expect(html(page)).toHaveAttribute('data-auto-drive', 'on');
  await expect(page.locator('.toast').filter({ hasText: 'Auto-drive on' })).toBeVisible();
  await expect(autoButton).toHaveAttribute('aria-pressed', 'true');
  // It drives off by itself, the pedals untouched.
  await expect.poll(() => shownSpeed(page), { timeout: 30_000 }).toBeGreaterThan(15);

  // The tablet: two cards turned.
  await page.locator('[data-action="tablet"]').click();
  const tablet = page.locator('.cab-tablet');
  await expect(tablet).toBeVisible();
  await expect(tablet.locator('[data-value="memory"]')).toHaveText('Pairs 0/8 · Turns: 0');
  const cards = tablet.locator('.cab-tablet__card');
  await expect(cards).toHaveCount(16);
  await cards.nth(0).click();
  await cards.nth(1).click();
  await expect(tablet.locator('[data-value="memory"]')).toHaveText(/^Pairs [01]\/8 · Turns: 1$/);
  await expect(cards.nth(0)).toHaveClass(/is-up/);

  // A firm turn of the wheel: the driver's again, and the tablet is put away.
  await page.keyboard.down('ArrowLeft');
  await expect(html(page)).toHaveAttribute('data-auto-drive', 'off');
  await page.keyboard.up('ArrowLeft');
  await expect(page.locator('.toast').filter({ hasText: 'You took the wheel.' })).toBeVisible();
  await expect(tablet).toBeHidden();
  await expect(autoButton).toHaveAttribute('aria-pressed', 'false');
  expect(problems).toEqual([]);
});

test('without the research, auto-drive is nowhere to be seen', async ({ page }) => {
  const problems = watchForProblems(page);
  await openGame(page, `${OPEN_ROAD}&lang=en`);
  await openPanel(page, 'jobs');
  await takeContract(page, 'market_shipment');

  await expect(page.locator('.mission-hud')).toBeVisible();
  await expect(page.locator('[data-action="auto-drive"]')).toBeHidden();
  await page.keyboard.press('KeyV');
  await expect(page.locator('.toast').filter({ hasText: 'Auto-drive comes with the Autopilot research.' })).toBeVisible();
  expect(problems).toEqual([]);
});
