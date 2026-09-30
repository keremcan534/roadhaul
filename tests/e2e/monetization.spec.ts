import { expect, test, type Page } from '@playwright/test';
import { closePanel, foundCompany, openCompanyHq, openGame, openMainMenu, openPanel, takeContract, watchForProblems } from './support';

/**
 * Ads and purchases in a browser, with the simulated ads and store (`?ads=simulated`, `?store=simulated`) standing in
 * for AdMob and Google Play: the Android app's own are behind the same interfaces (MonetizationService).
 */

const html = (page: Page) => page.locator('html');

/** Delivers the first contract by the debug key (T parks the truck in the bay it needs next). */
async function deliverFirstPackage(page: Page): Promise<void> {
  await takeContract(page, 'first_package');
  await page.keyboard.press('KeyT');
  await expect(html(page)).toHaveAttribute('data-mission-state', 'loaded', { timeout: 15_000 });
  await page.keyboard.down('ArrowUp');
  await expect(html(page)).toHaveAttribute('data-mission-state', 'delivering', { timeout: 10_000 });
  await page.keyboard.up('ArrowUp');
  await page.keyboard.press('KeyT');
  await expect(page.locator('.result-dialog')).toBeVisible({ timeout: 15_000 });
}

const credits = (text: string | null): number => Number((text ?? '').replace(/\D/g, ''));

test('shows no ads, no shop and no purchase settings in the web game', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  await openMainMenu(page, '?lang=en&debug');
  await expect(page.locator('[data-action="shop"]')).toBeHidden();
  await page.locator('[data-action="settings"]').click();
  await expect(page.locator('.settings__purchases')).toBeHidden();
  await page.locator('[data-action="close-settings"]').click();

  await foundCompany(page);
  await openPanel(page, 'jobs');
  await deliverFirstPackage(page);
  await expect(page.locator('[data-action="claim-bonus"]')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('pays a bonus on a delivery for a rewarded ad watched to its end', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  await openCompanyHq(page, '?lang=en&debug&ads=simulated');
  await deliverFirstPackage(page);

  const result = page.locator('.result-dialog');
  const total = credits(await result.locator('.result-dialog__line.is-total dd').textContent());
  const bonus = Math.min(2500, Math.max(100, Math.round(total * 0.25)));
  const claim = result.locator('[data-action="claim-bonus"]');
  await expect(claim).toHaveText(`Watch an ad: +${bonus.toLocaleString('en-GB')} credits`);

  // Skipped: no bonus, and the button stays for another try.
  await claim.click();
  const ad = page.locator('.simulated');
  await expect(ad).toBeVisible();
  await ad.locator('[data-action="skip-ad"]').click();
  await expect(page.locator('.toast')).toContainText('The ad closed early');
  await expect(claim).toBeEnabled();

  // Watched to the end: the bonus is paid, and shown as a line of the result.
  await claim.click();
  await expect(ad).toHaveAttribute('data-rewarded', 'true', { timeout: 10_000 });
  await ad.locator('[data-action="close-ad"]').click();
  await expect(claim).toHaveCount(0);
  await expect(result.locator('.result-dialog__rivalry.is-bonus')).toContainText(`+${bonus.toLocaleString('en-GB')} credits`);
  await expect(result.locator('.result-dialog__line').last()).toContainText(
    `${(5000 + total + bonus).toLocaleString('en-GB')} credits`,
  );

  await result.locator('[data-action="continue"]').click();
  await expect(html(page)).toHaveAttribute('data-game-state', 'driving');
  expect(problems).toEqual([]);
});

test('fills the tank at half price after a rewarded ad at the rest area', async ({ page }) => {
  test.slow(); // It drives until the gauge moves (up to 30 s, drawn in software).
  const problems = watchForProblems(page);
  await openGame(page, '?lang=en&debug&fuelScale=60&ads=simulated');
  const gauge = page.locator('.dashboard__gauge--fuel');
  await expect(gauge).toHaveAttribute('data-percent', '100');
  await page.keyboard.down('ArrowUp');
  await expect.poll(async () => Number(await gauge.getAttribute('data-percent')), { timeout: 30_000 }).toBeLessThan(100);
  await page.keyboard.up('ArrowUp');

  await page.keyboard.press('KeyY');
  const counter = page.locator('.rest-area-panel');
  await expect(counter).toBeVisible();
  await expect(counter.locator('.service-discounts__note')).toHaveText('Half price after a short ad: 5 left today');
  const full = credits(await counter.locator('[data-action="rest-refuel"]').textContent());
  const discounted = counter.locator('[data-action="refuel-discount"]');
  await expect(discounted).toContainText(`${Math.round(full / 2).toLocaleString('en-GB')} credits`);

  await discounted.click();
  const ad = page.locator('.simulated');
  await expect(ad).toHaveAttribute('data-rewarded', 'true', { timeout: 10_000 });
  await ad.locator('[data-action="close-ad"]').click();
  await expect(page.locator('.toast')).toContainText('Refuelled');
  await expect(counter.locator('[data-action="rest-refuel"]')).toHaveText('Tank full');
  await expect(counter.locator('.service-discounts')).toHaveCount(0); // Nothing left to discount here.
  expect(problems).toEqual([]);
});

test('sells the premium paints in the shop, keeps them, and paints a truck in one for free', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  await openMainMenu(page, '?lang=en&store=simulated');

  // Without ads there is nothing to remove: the shop sells the paints alone.
  const shopButton = page.locator('[data-action="shop"]');
  await expect(shopButton).toBeVisible();
  await shopButton.click();
  const shop = page.locator('.shop');
  await expect(shop.locator('.shop__product')).toHaveCount(1);
  const paints = shop.locator('.shop__product[data-product="premium_paints"]');
  await expect(paints.locator('.shop__product-name')).toHaveText('Premium paints');
  await expect(paints.locator('[data-action="buy-product"]')).toHaveText('Buy · €1.99');

  // Cancelled first: nothing bought.
  await paints.locator('[data-action="buy-product"]').click();
  await page.locator('.simulated [data-action="simulated-cancel"]').click();
  await expect(paints.locator('[data-action="buy-product"]')).toBeEnabled();

  await paints.locator('[data-action="buy-product"]').click();
  await page.locator('.simulated [data-action="simulated-buy"]').click();
  await expect(page.locator('.toast')).toContainText('Thank you! Premium paints unlocked.');
  await expect(paints.locator('.shop__owned')).toHaveText('Owned');
  await page.locator('[data-action="close-shop"]').click();

  // The premium colours in the garage, free to use now.
  await foundCompany(page);
  await openPanel(page, 'garage');
  const candyRed = page.locator('.paint-picker__swatch.is-premium[data-paint-id="candy_red"]');
  await expect(candyRed).not.toHaveClass(/is-for-sale/);
  await candyRed.click();
  await expect(page.locator('[data-action="paint-truck"]')).toHaveText('Paint it');
  await page.locator('[data-action="paint-truck"]').click();
  await expect(page.locator('.toast').last()).toContainText('Candy red');
  await closePanel(page);

  // Settings can read the purchases back from the store.
  await page.keyboard.press('Escape');
  await page.locator('[data-action="pause-settings"]').click();
  const restore = page.locator('.settings [data-action="restore-purchases"]');
  await expect(restore).toBeVisible();
  await restore.click();
  await expect(page.locator('.toast').last()).toContainText('Purchases restored.');
  expect(problems).toEqual([]);
});

test('offers "Remove ads" where there are ads, and then gives the bonus without one', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  await openMainMenu(page, '?lang=en&debug&ads=simulated&store=simulated');
  await page.locator('[data-action="settings"]').click();
  await expect(page.locator('.settings [data-action="ad-privacy"]')).toBeVisible();
  await page.locator('[data-action="close-settings"]').click();

  await page.locator('[data-action="shop"]').click();
  const removeAds = page.locator('.shop__product[data-product="remove_ads"]');
  await expect(page.locator('.shop__product')).toHaveCount(2);
  await removeAds.locator('[data-action="buy-product"]').click();
  await page.locator('.simulated [data-action="simulated-buy"]').click();
  await expect(removeAds.locator('.shop__owned')).toHaveText('Owned');
  await page.locator('[data-action="close-shop"]').click();

  await foundCompany(page);
  await openPanel(page, 'jobs');
  await deliverFirstPackage(page);
  const claim = page.locator('[data-action="claim-bonus"]');
  await expect(claim).toContainText('Collect a bonus');
  await claim.click();
  await expect(page.locator('.simulated')).toHaveCount(0);
  await expect(page.locator('.result-dialog__rivalry.is-bonus')).toBeVisible();
  expect(problems).toEqual([]);
});
