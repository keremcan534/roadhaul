import { expect, test } from '@playwright/test';
import { continueSavedCompany, openCompanyHq, openPanel, savedCompany, takeContract, watchForProblems } from './support';

const html = (page: import('@playwright/test').Page) => page.locator('html');

test('celebrates a delivery: its stars land, what it earned counts up, and the perfect streak starts', async ({ page }, testInfo) => {
  test.slow();
  const problems = watchForProblems(page);
  await openCompanyHq(page, '?debug&lang=en');
  await takeContract(page, 'first_package');
  // Debug key: park in the next bay; on time, the cargo untouched.
  await page.keyboard.press('KeyT');
  await expect(html(page)).toHaveAttribute('data-mission-state', 'loaded', { timeout: 15_000 });
  await page.keyboard.down('ArrowUp');
  await expect(html(page)).toHaveAttribute('data-mission-state', 'delivering', { timeout: 10_000 });
  await page.keyboard.up('ArrowUp');
  await page.keyboard.press('KeyT');

  const result = page.locator('.result-dialog');
  await expect(result).toBeVisible({ timeout: 15_000 });
  const stars = result.locator('[data-value="stars"]');
  await expect(stars).toHaveAttribute('data-stars', '3');
  await expect(stars.locator('.result-star.is-lit')).toHaveCount(3);
  await expect(result.locator('.result-dialog__perfect')).toHaveText('Perfect delivery!');
  // The tally ends on the receipt's total.
  const total = (await result.locator('.result-dialog__line.is-total dd').textContent())!;
  await expect(result.locator('.result-dialog__tally')).toHaveText(`+${total}`);
  await expect(result.locator('.result-dialog__streak')).toContainText('Perfect streak: 1');
  await expect(result.locator('.result-dialog__streak')).toContainText('Next: Bronze crate in 2');
  await testInfo.attach('stars', { body: await page.screenshot(), contentType: 'image/png' });
  expect(problems).toEqual([]);
});

test('opens a crate from the company panel: it shakes, bursts, and pays', async ({ page }, testInfo) => {
  test.slow();
  const problems = watchForProblems(page);
  const save = JSON.parse(savedCompany({ credits: 10_000 })) as Record<string, unknown>;
  // A save from this build: two crates waiting.
  Object.assign(save, {
    version: 14,
    tutorial: { step: 'done' },
    fleet: { drivers: [], jobsPlanned: 0 },
    rivals: { companies: [], standing: [], campaignCooldowns: [], tender: null, race: null, nextTenderSeconds: null, tendersPosted: 0, jobsPlanned: 0 },
    events: { runs: [] },
    facilities: { levels: {} },
    daily: { lastClaimDay: null, streak: 0 },
    achievements: { counters: {}, claimed: [] },
    crates: { held: { gold: 1, bronze: 1 }, opened: 0, paints: [], perfectStreak: 2, bestPerfectStreak: 2 },
    levelRewards: { rewardedLevel: 2 },
  });
  const garage = save['garage'] as { vehicles: Record<string, unknown>[] };
  garage.vehicles = garage.vehicles.map((vehicle) => ({ ...vehicle, paintId: null }));
  await continueSavedCompany(page, JSON.stringify(save), '?lang=en');
  await openPanel(page, 'jobs');
  await expect(page.locator('[data-value="crates-waiting"]')).toHaveText('2');
  await page.locator('[data-action="open-crates"]').click();
  const crates = page.locator('.crates');
  await expect(crates).toBeVisible();
  await expect(crates.locator('[data-value="crates-gold"]')).toHaveText('×1');
  await expect(crates.locator('[data-value="crates-bronze"]')).toHaveText('×1');
  // The best first.
  await expect(crates.locator('.crates__stage')).toHaveAttribute('data-tier', 'gold');

  await crates.locator('[data-action="open-crate"]').click();
  const credits = crates.locator('[data-value="crate-credits"]');
  await expect(credits).toBeVisible({ timeout: 5000 });
  await testInfo.attach('opened', { body: await page.screenshot(), contentType: 'image/png' });
  const paid = Number((await credits.textContent())!.replace(/\D/g, ''));
  expect(paid).toBeGreaterThanOrEqual(2500);
  await expect(crates.locator('[data-value="crates-gold"]')).toHaveText('×0');
  await expect(page.locator('[data-value="crates-waiting"]')).toHaveText('1');

  // The other one, then none left.
  await crates.locator('[data-action="open-another"]').click();
  await expect(crates.locator('.crates__stage')).toHaveAttribute('data-tier', 'bronze');
  await crates.locator('[data-action="open-crate"]').click();
  await expect(crates.locator('[data-value="crate-credits"]')).toBeVisible({ timeout: 5000 });
  await expect(crates.locator('[data-action="open-another"]')).toBeHidden();
  await expect(page.locator('[data-value="crates-waiting"]')).toBeHidden();
  await crates.locator('[data-action="close-crates"]').click();
  await expect(crates).toBeHidden();
  const balance = Number((await page.locator('.hq__credits').textContent())!.replace(/\D/g, ''));
  expect(balance).toBeGreaterThan(10_000 + paid);
  expect(problems).toEqual([]);
});

test('celebrates the levels a company reached while away, and pays each one collected', async ({ page }, testInfo) => {
  test.slow();
  const problems = watchForProblems(page);
  // Saved at level 3 by an older build, its XP now reaches level 4: that level's reward waits.
  await continueSavedCompany(page, savedCompany({ credits: 1000, xp: 7000 }), '?lang=en');
  await expect(page.locator('.toast', { hasText: 'Level 4!' })).toBeVisible();
  await openPanel(page, 'jobs');
  const show = page.locator('.level-up');
  await expect(show).toBeVisible({ timeout: 5000 });
  await expect(show.locator('[data-value="level-up-level"]')).toHaveText('4');
  await expect(show.locator('.level-up__name')).toHaveText('Professional Carrier');
  await expect(show.locator('.level-up__unlock')).not.toHaveCount(0);
  await testInfo.attach('level', { body: await page.screenshot(), contentType: 'image/png' });

  await show.locator('[data-action="collect-level"]').click();
  await expect(page.locator('.hq__credits')).toHaveText('5,000 credits');
  await expect(page.locator('[data-value="crates-waiting"]')).toHaveText('1');
  // Straight to its crate.
  await show.locator('[data-action="level-open-crate"]').click();
  await expect(show).toBeHidden();
  await expect(page.locator('.crates')).toBeVisible();
  await expect(page.locator('.crates__stage')).toHaveAttribute('data-tier', 'silver');
  expect(problems).toEqual([]);
});
