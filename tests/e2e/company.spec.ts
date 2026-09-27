import { expect, test } from '@playwright/test';
import { continueSavedCompany, openPanel, savedCompany, watchForProblems } from './support';

/** A level 2 company with 30,000 credits, its truck half wrecked: a full repair would cost 3,000. */
function battered(): string {
  const save = JSON.parse(savedCompany({ credits: 30_000, xp: 1000 })) as { garage: { vehicles: { damage: number }[] } };
  save.garage.vehicles[0]!.damage = 0.5;
  return JSON.stringify(save);
}

test('builds a workshop at the head office a level at a time: repairs cost less, and it stays built', async ({ page }, testInfo) => {
  test.slow(); // The game starts twice: before and after the reload.
  const problems = watchForProblems(page);
  await continueSavedCompany(page, battered(), '?lang=en');
  const credits = page.locator('.hq__credits');
  const repair = page.locator('[data-action="repair"]');

  await openPanel(page, 'truck');
  await expect(repair).toHaveText('Repair · 3,000 credits');

  // Nothing built yet: every facility can be, its first level for a company at level 2.
  await openPanel(page, 'company');
  await expect(page.locator('[data-value="perks"]')).toHaveText('Nothing built yet: a workshop or a fuel depot soon pays for itself.');
  await expect(page.locator('.facility-card')).toHaveCount(7);
  await expect(page.locator('.facility-card [data-action="build-facility"]')).toHaveCount(7);
  const workshop = page.locator('.facility-card[data-facility-id="workshop"]');
  await expect(workshop.locator('.upgrade-card__title')).toHaveText('Workshop');
  await expect(workshop.locator('.upgrade-card__effect')).toHaveText('Not built yet');
  await expect(workshop.locator('.upgrade-card__next')).toHaveText('Level 1: Repair costs −15%');

  // Built: paid for, and its perk shows.
  await workshop.locator('[data-action="build-facility"]').click();
  await expect(page.locator('.toast').filter({ hasText: 'Workshop: level 1 ready.' })).toBeVisible();
  await expect(credits).toHaveText('25,000 credits');
  await expect(workshop).toHaveAttribute('data-level', '1');
  await expect(workshop.locator('.upgrade-card__effect')).toHaveText('Repair costs −15%');
  await expect(page.locator('.hq__perk[data-effect="repairDiscount"]')).toHaveText('Repair costs −15%');

  // Its second level, and the third waits for level 4.
  await expect(workshop.locator('[data-action="build-facility"]')).toHaveText('Expand · 12,000 credits');
  await workshop.locator('[data-action="build-facility"]').click();
  await expect(credits).toHaveText('13,000 credits');
  await expect(workshop).toHaveAttribute('data-level', '2');
  await expect(workshop.locator('.upgrade-card__next')).toHaveText('Level 3: Repair costs −45%');
  await expect(workshop.locator('.upgrade-card__status')).toHaveText('Unlocks at level 4');
  await expect(workshop.locator('[data-action="build-facility"]')).toHaveCount(0);
  await testInfo.attach('company', { body: await page.screenshot(), contentType: 'image/png' });

  await openPanel(page, 'truck');
  await expect(repair).toHaveText('Repair · 2,100 credits');

  // Kept in the save: the company comes back with its workshop.
  await page.reload();
  await page.locator('[data-action="continue-game"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-game-state', 'driving');
  await openPanel(page, 'company');
  await expect(workshop).toHaveAttribute('data-level', '2');
  await openPanel(page, 'truck');
  await expect(repair).toHaveText('Repair · 2,100 credits');
  expect(problems).toEqual([]);
});
