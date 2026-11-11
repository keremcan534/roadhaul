import { expect, test } from '@playwright/test';
import { continueSavedCompany, openPanel, savedCompany, watchForProblems } from './support';

test('buys a used truck from the garage\'s market and sells a truck, a first tap asking', async ({ page }, testInfo) => {
  test.slow();
  const problems = watchForProblems(page);
  // Level 1 (two garage places), two trucks: room for none until one is sold.
  await continueSavedCompany(
    page,
    savedCompany({
      credits: 200_000,
      xp: 0,
      trucks: [
        { instanceId: 'truck_001', definitionId: 'rh_h1', fuelLiters: 150 },
        { instanceId: 'truck_002', definitionId: 'rh_h1', fuelLiters: 150 },
      ],
    }),
    '?lang=en',
  );
  await openPanel(page, 'garage');
  const used = page.locator('.hq__section--used');
  await expect(used.locator('.used-truck')).toHaveCount(3);
  await expect(used.locator('.hq__note')).toContainText('Other trucks arrive in');
  // The garage is full: nothing to buy yet.
  await expect(used.locator('[data-action="buy-used-truck"]').first()).toBeDisabled();

  const owned = page.locator('.hq__section--owned');
  await expect(owned.locator('.hq__section-title')).toHaveText('Your trucks (2/2)');
  await expect(owned.locator('.owned-trucks__row')).toHaveCount(2);
  // The one driven cannot be sold.
  await expect(owned.locator('[data-instance-id="truck_001"] [data-action="sell-truck"]')).toHaveCount(0);
  const sell = owned.locator('[data-instance-id="truck_002"] [data-action="sell-truck"]');
  await expect(sell).toHaveText(/^Sell: [\d,]+ credits$/);
  const price = Number((await sell.textContent())!.replace(/\D/g, ''));
  await sell.click();
  await expect(sell).toHaveText(`Sure? Sell for ${price.toLocaleString('en-GB')} credits`);
  await sell.click();
  await expect(page.locator('.toast').filter({ hasText: `Sold the RoadHaul H1 for ${price.toLocaleString('en-GB')} credits.` })).toBeVisible();
  await expect(page.locator('.hq__credits')).toHaveText(`${(200_000 + price).toLocaleString('en-GB')} credits`);
  await expect(owned.locator('.owned-trucks__row')).toHaveCount(1);

  // Room again: a used truck bought goes into the garage, and shows sold.
  const card = used.locator('.used-truck').first();
  const buy = card.locator('[data-action="buy-used-truck"]');
  await expect(buy).toBeEnabled();
  await buy.click();
  await expect(page.locator('.toast').filter({ hasText: 'The used RoadHaul H1 is yours' })).toBeVisible();
  await expect(card).toHaveClass(/is-sold/);
  await expect(card.locator('.truck-card__status')).toHaveText('Sold');
  await expect(owned.locator('.owned-trucks__row')).toHaveCount(2);
  await testInfo.attach('used trucks', { body: await page.screenshot(), contentType: 'image/png' });
  expect(problems).toEqual([]);
});
