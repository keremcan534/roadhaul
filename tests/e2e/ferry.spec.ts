import { expect, test, type Page } from '@playwright/test';
import { continueSavedCompany, leaveDailyReward, openMainMenu, openPanel, watchForProblems } from './support';

/** Names the company in the dialog and starts it: the game starts again in the region picked, the truck on the road. */
async function foundCompanyAfterReload(page: Page, name: string): Promise<void> {
  await page.locator('[data-action="new-company"]').click();
  await page.locator('.new-company__input').fill(name);
  await page.locator('[data-action="start-company"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-game-state', 'driving', { timeout: 60_000 });
}

/** A company of level 4 (past the ferry's, 2), or of `level`, with its truck standing at Gull Point's ferry terminal. */
function companyAtTheFerry(level = 4): string {
  return JSON.stringify({
    version: 4,
    createdAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_000_000,
    profile: { companyName: 'Kuzey Lojistik' },
    company: { level, xp: level === 4 ? 7_000 : 0, reputation: 20 },
    economy: { credits: 30_000 },
    garage: {
      activeVehicleInstanceId: 'truck_001',
      vehicles: [{ instanceId: 'truck_001', definitionId: 'rh_h1', fuelLiters: 120, damage: 0, upgrades: {} }],
    },
    world: { mapId: 'north_valley', truck: { x: -2560, z: -2090, headingRadians: (53 * Math.PI) / 180 } },
    missions: { active: null },
    stats: { deliveriesCompleted: 6, deliveriesFailed: 0, creditsEarned: 12_000, distanceDrivenMeters: 40_000 },
  });
}

test('crosses on the ferry from Gull Point to Metropol, and finds Metropol\'s contracts there', async ({ page }, testInfo) => {
  test.slow();
  const problems = watchForProblems(page);
  await continueSavedCompany(page, companyAtTheFerry(), '?lang=en&traffic=0');

  // Standing at the terminal, the counter offers the crossing.
  const panel = page.locator('.ferry-panel');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel).toContainText('Ferry to Metropol');
  await testInfo.attach('terminal', { body: await page.screenshot(), contentType: 'image/png' });
  await page.locator('[data-action="ferry-travel"]').click();
  // On board: the crossing over the screen as the game starts again on the other side.
  await expect(page.locator('.ferry-crossing[data-stage="departing"]')).toContainText('Ferry to Metropol');
  await testInfo.attach('crossing', { body: await page.screenshot(), contentType: 'image/png' });

  // The game starts again over the water, coming into port, the company driving on at once.
  await expect(page.locator('.toast').filter({ hasText: 'Welcome to Metropol!' })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.ferry-crossing')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-game-state', 'driving');
  // The daily reward, left for later, greets the company again as the game starts.
  await leaveDailyReward(page);
  // Off the ferry beside the terminal, not in it: the counter waits until the truck drives back in.
  await expect(panel).toBeHidden();
  await testInfo.attach('metropol', { body: await page.screenshot(), contentType: 'image/png' });

  // The job board holds Metropol's own contracts.
  await openPanel(page, 'jobs');
  await expect(page.locator('.job-card[data-mission-id="city_lights"]')).toBeVisible();
  await expect(page.locator('.job-card[data-mission-id="first_package"]')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('founds a new company in Metropol straight from the main menu, and has its contracts at once', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  await openMainMenu(page, '?lang=en&traffic=0');
  // After the places to start at, the region over the water.
  const metropol = page.locator('.main-menu__place[data-region="metropol"]');
  await expect(metropol).toHaveText('Metropol');
  await metropol.click();
  // The game starts again over there to found it.
  await foundCompanyAfterReload(page, 'Metro Lojistik');
  await openPanel(page, 'jobs');
  await expect(page.locator('.job-card[data-mission-id="city_lights"]')).toBeVisible();
  await expect(page.locator('.job-card[data-mission-id="first_package"]')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('keeps a saved company below the ferry\'s level on this side of the water on the main menu', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  await page.addInitScript((json) => localStorage.setItem('roadhaul.save', json), companyAtTheFerry(1));
  await openMainMenu(page, '?lang=en&traffic=0');
  await page.locator('.main-menu__place[data-region="metropol"]').click();
  // Below the ferry's level: Continue waits, and the note says when it opens.
  await expect(page.locator('[data-action="continue-game"]')).toBeDisabled();
  await expect(page.locator('.main-menu__start-note')).toHaveText(
    'The ferry to Metropol runs from company level 2. A new company can start there right away.',
  );
  // Back to a place on this side: Continue is open again.
  await page.locator('.main-menu__place[data-start="left"]').click();
  await expect(page.locator('[data-action="continue-game"]')).toBeEnabled();
  await expect(page.locator('.main-menu__start-note')).toBeHidden();
  expect(problems).toEqual([]);
});

test('takes a saved company of the ferry\'s level over the water from the main menu, without the drive to the terminal', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  await page.addInitScript((json) => {
    if (sessionStorage.getItem('roadhaul.e2e.seeded') === null) {
      localStorage.setItem('roadhaul.save', json);
      sessionStorage.setItem('roadhaul.e2e.seeded', 'yes');
    }
  }, companyAtTheFerry());
  await openMainMenu(page, '?lang=en&traffic=0');
  await page.locator('.main-menu__place[data-region="metropol"]').click();
  await page.locator('[data-action="continue-game"]').click();
  await expect(page.locator('.ferry-crossing[data-stage="departing"]')).toContainText('Ferry to Metropol');
  await expect(page.locator('.toast').filter({ hasText: 'Welcome to Metropol!' })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('html')).toHaveAttribute('data-game-state', 'driving');
  expect(problems).toEqual([]);
});
