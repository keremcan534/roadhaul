import { expect, test } from '@playwright/test';
import { continueGame, continueSavedCompany, openPanel, savedCompany, watchForProblems } from './support';

/** A level 2 company with 30,000 credits, its truck half wrecked: a full repair would cost 1,500 (half of a quarter of the H1's 12,000). */
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
  await expect(repair).toHaveText('Repair · 1,500 credits');

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
  await expect(repair).toHaveText('Repair · 1,050 credits');

  // Kept in the save: the company comes back with its workshop.
  await page.reload();
  await continueGame(page);
  await expect(page.locator('html')).toHaveAttribute('data-game-state', 'driving');
  await openPanel(page, 'company');
  await expect(workshop).toHaveAttribute('data-level', '2');
  await openPanel(page, 'truck');
  await expect(repair).toHaveText('Repair · 1,050 credits');
  expect(problems).toEqual([]);
});

test('researches a step of the research tree with the points deliveries earned', async ({ page }, testInfo) => {
  test.slow();
  const problems = watchForProblems(page);
  await continueSavedCompany(page, researchSave(5), '?lang=en');
  await openPanel(page, 'company');

  const tree = page.locator('.hq__section--research');
  await expect(tree.locator('[data-value="research-points"]')).toHaveText('Research points: 5');
  await expect(tree.locator('.research__branch')).toHaveCount(3);
  await expect(tree.locator('.research-node')).toHaveCount(12);
  await expect(tree.locator('.research-node[data-state="available"]')).toHaveCount(3);
  const rates = tree.locator('.research-node[data-research-id="better_rates"]');
  await expect(rates.locator('.research-node__name')).toHaveText('Better Rates');
  await expect(rates.locator('.research-node__effect')).toHaveText('Delivery pay +3%');
  await expect(rates.locator('[data-action="research"]')).toHaveText('Research · 3 RP · 2,000 credits');

  await rates.locator('[data-action="research"]').click();
  await expect(page.locator('.toast').filter({ hasText: 'Better Rates researched!' })).toBeVisible();
  await expect(page.locator('.hq__credits')).toHaveText('8,000 credits');
  await expect(rates).toHaveAttribute('data-state', 'researched');
  await expect(tree.locator('[data-value="research-points"]')).toHaveText('Research points: 2');
  // The next step opens, but takes more points than are left.
  const training = tree.locator('.research-node[data-research-id="training_program"]');
  await expect(training).toHaveAttribute('data-state', 'available');
  await expect(training.locator('[data-action="research"]')).toBeDisabled();
  await testInfo.attach('research', { body: await page.screenshot(), contentType: 'image/png' });
  expect(problems).toEqual([]);
});

/** A level 2 company from this build with 10,000 credits and `points` research points, nothing researched. */
function researchSave(points: number): string {
  const save = JSON.parse(savedCompany({ credits: 10_000 })) as Record<string, unknown>;
  Object.assign(save, {
    version: 17,
    tutorial: { step: 'done' },
    fleet: { drivers: [], jobsPlanned: 0 },
    rivals: { companies: [], standing: [], campaignCooldowns: [], tender: null, race: null, nextTenderSeconds: null, tendersPosted: 0, jobsPlanned: 0 },
    events: { runs: [] },
    facilities: { levels: {} },
    daily: { lastClaimDay: null, streak: 0 },
    achievements: { counters: {}, claimed: [] },
    crates: { held: {}, opened: 0, paints: [], liveries: [], perfectStreak: 0, bestPerfectStreak: 0, freeCrateAtMs: 4_102_444_800_000 },
    levelRewards: { rewardedLevel: 2 },
    supplies: { parts: 0, boosters: {}, payBoostLeft: 0, xpBoostLeft: 0 },
    quests: { day: null, counts: {}, distanceStartMeters: 0, claimed: [], bonusClaimed: false },
    liveries: { bought: [], worn: {}, text: null },
    research: { points, researched: [] },
  });
  const garage = save['garage'] as { vehicles: Record<string, unknown>[] };
  garage.vehicles = garage.vehicles.map((vehicle) => ({ ...vehicle, paintId: null }));
  return JSON.stringify(save);
}
