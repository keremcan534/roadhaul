import { expect, test } from '@playwright/test';
import { continueSavedCompany, openPanel, savedCompany, watchForProblems } from './support';

test('spins the truck stop’s slot machine from the company panel, for the company’s credits', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  await continueSavedCompany(page, savedCompany({ credits: 30_000 }), '?lang=en');
  await openPanel(page, 'jobs');
  await page.locator('[data-action="open-casino"]').click();
  const casino = page.locator('.casino');
  await expect(casino).toBeVisible();
  await expect(casino.locator('[data-value="casino-credits"]')).toHaveText('30,000 credits');
  await expect(casino.locator('.casino__reel')).toHaveCount(3);
  await expect(casino.locator('.casino__note')).toContainText('never sold');

  // The biggest bet, then a spin: the reels run, stop, and the money is settled.
  await casino.locator('[data-action="casino-bet"][data-bet="500"]').click();
  await expect(casino.locator('[data-bet="500"]')).toHaveAttribute('aria-checked', 'true');
  await casino.locator('[data-action="casino-spin"]').click();
  await expect(casino.locator('[data-action="casino-spin"]')).toBeDisabled();
  await expect(casino.locator('[data-action="casino-spin"]')).toBeEnabled({ timeout: 10_000 });
  // Each reel stopped with its line's symbol in the middle of its window.
  for (const reel of await casino.locator('.casino__reel').all()) {
    const window = (await reel.boundingBox())!;
    const symbol = (await reel.locator('.casino__cell').nth(-2).boundingBox())!;
    expect(Math.abs(symbol.y + symbol.height / 2 - (window.y + window.height / 2))).toBeLessThan(4);
  }
  const message = await casino.locator('[data-value="casino-result"]').textContent();
  expect(message).toMatch(/won|bet back|No luck/);
  const credits = Number((await casino.locator('[data-value="casino-credits"]').textContent())!.replace(/\D/g, ''));
  const sitting = await casino.locator('[data-value="casino-sitting"]').textContent();
  expect(sitting).toMatch(/^This sitting: /);
  // What it paid is a multiple of a fifth of the bet (the pairs pay ×1.5), less the bet.
  expect((credits - 30_000 + 500) % 50).toBe(0);
  expect(credits).toBeGreaterThanOrEqual(29_500);

  // Closed: back to the panel, its credits the same.
  await casino.locator('[data-action="close-casino"]').click();
  await expect(casino).toBeHidden();
  await expect(page.locator('.hq__credits')).toHaveText(`${credits.toLocaleString('en')} credits`);
  expect(problems).toEqual([]);
});
