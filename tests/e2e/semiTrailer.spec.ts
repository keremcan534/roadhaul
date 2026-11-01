import { expect, test } from '@playwright/test';
import { continueSavedCompany, openPanel, takeContract, watchForProblems } from './support';

/** A company at the top level driving a T1, a tractor unit with a box semi-trailer. */
function rigCompany(): string {
  return JSON.stringify({
    version: 4,
    createdAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_000_000,
    profile: { companyName: 'Kuzey Lojistik' },
    company: { level: 10, xp: 80_000, reputation: 60 },
    economy: { credits: 200_000 },
    garage: {
      activeVehicleInstanceId: 'truck_001',
      vehicles: [{ instanceId: 'truck_001', definitionId: 'rh_t1', fuelLiters: 700, damage: 0, upgrades: {} }],
    },
    world: { mapId: 'north_valley', truck: null },
    missions: { active: null },
    stats: { deliveriesCompleted: 40, deliveriesFailed: 0, creditsEarned: 400_000, distanceDrivenMeters: 300_000 },
  });
}

test('hauls a semi-trailer\'s load with a tractor unit: loaded and unloaded with the trailer in the bay', async ({ page }, testInfo) => {
  test.slow();
  const problems = watchForProblems(page);
  await continueSavedCompany(page, rigCompany(), '?debug&lang=en&traffic=0');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-vehicle', 'rh_t1');

  // The truck page names what it pulls.
  await openPanel(page, 'truck');
  await expect(page.locator('.hq__truck-name')).toHaveText('RoadHaul T1 · Semi-trailer · Box body');
  await openPanel(page, 'jobs');
  await takeContract(page, 'store_restock');
  // Debug key: park in the next bay, the trailer in it and the tractor out ahead.
  await page.keyboard.press('KeyT');
  await expect(html).toHaveAttribute('data-mission-state', 'loaded', { timeout: 15_000 });
  await testInfo.attach('loaded', { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.down('ArrowUp');
  await expect(html).toHaveAttribute('data-mission-state', 'delivering', { timeout: 10_000 });
  await page.keyboard.up('ArrowUp');
  await page.keyboard.press('KeyT');

  await expect(page.locator('.result-dialog')).toBeVisible({ timeout: 15_000 });
  expect(problems).toEqual([]);
});
