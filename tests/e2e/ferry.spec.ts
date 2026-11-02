import { expect, test } from '@playwright/test';
import { continueSavedCompany, leaveDailyReward, openPanel, watchForProblems } from './support';

/** A company of level 4 (the ferry's) with its truck standing at Gull Point's ferry terminal. */
function companyAtTheFerry(): string {
  return JSON.stringify({
    version: 4,
    createdAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_000_000,
    profile: { companyName: 'Kuzey Lojistik' },
    company: { level: 4, xp: 7_000, reputation: 20 },
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
  await expect(page.locator('.toast').filter({ hasText: 'All aboard for Metropol' })).toBeVisible();

  // The game starts again over the water, the company driving on at once.
  await expect(page.locator('.toast').filter({ hasText: 'Welcome to Metropol!' })).toBeVisible({ timeout: 60_000 });
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
