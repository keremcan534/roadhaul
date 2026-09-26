import { expect, test } from '@playwright/test';
import { closePanel, continueSavedCompany, openPanel, savedCompany, watchForProblems } from './support';

test('hires a driver, buys a second truck and sends it out on contracts that pay the company, kept across a reload', async ({
  page,
}, testInfo) => {
  test.slow(); // The game started twice, drawn in software.
  const problems = watchForProblems(page);
  await continueSavedCompany(page, savedCompany({ credits: 40_000 }), '?lang=en&debug');
  const credits = page.locator('.hq__credits');

  // The fleet: the company's one truck, driven by the player, and drivers looking for work.
  await openPanel(page, 'fleet');
  await expect(page.locator('.fleet__summary')).toHaveText(/^0 of 1 trucks out with drivers/);
  await expect(page.locator('.fleet-truck[data-instance-id="truck_001"]')).toHaveAttribute('data-state', 'you');
  await page.locator('[data-action="hire-driver"][data-driver-id="driver_selin"]').click();
  await expect(credits).toHaveText('38,500 credits');
  await expect(page.locator('.driver-card[data-driver-id="driver_selin"]')).toHaveAttribute('data-hired', 'true');

  // Another of the same truck, from the garage.
  await openPanel(page, 'garage');
  await page.locator('.truck-card[data-vehicle-id="rh_h1"] [data-action="buy-another-truck"]').click();
  await expect(credits).toHaveText('26,500 credits');
  await expect(page.locator('.truck-card[data-vehicle-id="rh_h1"] .truck-card__owned')).toHaveText('You have 2');

  // Out on a contract with Selin at once.
  await openPanel(page, 'fleet');
  const second = page.locator('.fleet-truck[data-instance-id="truck_002"]');
  await second.locator('[data-action="assign-driver"][data-driver-id="driver_selin"]').click();
  await expect(second).toHaveAttribute('data-state', 'onContract');
  await expect(second.locator('.fleet-truck__status')).toHaveText(/^Selin Y\.: \S+ → \S+ · /);
  await testInfo.attach('fleet', { body: await page.screenshot(), contentType: 'image/png' });

  // Ten minutes later (debug F): delivered and paid.
  await closePanel(page);
  await page.keyboard.press('KeyF');
  await expect(page.locator('.toast').filter({ hasText: /^Selin Y\. delivered / }).first()).toBeVisible();
  await openPanel(page, 'fleet');
  const earned = Number((await credits.textContent())!.replace(/\D/g, ''));
  expect(earned).toBeGreaterThan(26_500);
  await expect(page.locator('.driver-card[data-driver-id="driver_selin"] .driver-card__record')).toHaveText(/^[1-9]\d* contracts · \+/);

  // Kept across a reload: the driver still has the truck out.
  await page.reload();
  await page.locator('[data-action="continue-game"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-game-state', 'driving');
  await openPanel(page, 'fleet');
  await expect(second).toHaveAttribute('data-state', /^(onContract|settingOff|inWorkshop)$/);

  // Called back to the garage: the player may drive it.
  await second.locator('[data-action="recall-truck"]').click();
  await expect(second).toHaveAttribute('data-state', 'idle');
  await second.locator('[data-action="drive-truck"]').click();
  await expect(page.locator('.fleet-truck[data-instance-id="truck_002"]')).toHaveAttribute('data-state', 'you');
  expect(problems).toEqual([]);
});

test('gives a driver waiting for a truck one from their card: bought for them, or one waiting in the garage', async ({ page }) => {
  const problems = watchForProblems(page);
  await continueSavedCompany(page, savedCompany({ credits: 40_000 }), '?lang=en');
  const credits = page.locator('.hq__credits');
  await openPanel(page, 'fleet');
  await page.locator('[data-action="hire-driver"][data-driver-id="driver_selin"]').click();
  const selin = page.locator('.driver-card[data-driver-id="driver_selin"][data-hired="true"]');
  await expect(selin.locator('.driver-card__status')).toHaveText('Waiting for a truck');

  // No truck waiting in the garage: the cheapest on sale, bought and sent out with her at once.
  const buy = selin.locator('[data-action="buy-truck-for"]');
  await expect(buy).toHaveText('Buy them a RoadHaul H1 · 12,000 credits');
  await buy.click();
  await expect(credits).toHaveText('26,500 credits');
  const second = page.locator('.fleet-truck[data-instance-id="truck_002"]');
  await expect(second).toHaveAttribute('data-state', 'onContract');
  await expect(selin.locator('.driver-card__status')).toHaveText(/^Drives the RoadHaul H1 · /);

  // Called back, the truck waits in the garage, and her card gives it back to her.
  await second.locator('[data-action="recall-truck"]').click();
  const give = selin.locator('[data-action="give-truck"]');
  await expect(give).toHaveAttribute('data-instance-id', 'truck_002');
  await give.click();
  await expect(second).toHaveAttribute('data-state', 'onContract');
  await expect(credits).toHaveText('26,500 credits');
  expect(problems).toEqual([]);
});
