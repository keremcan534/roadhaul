import { expect, test, type Page } from '@playwright/test';
import { continueSavedCompany, openCompanyHq, savedCompany, watchForProblems } from './support';

const html = (page: Page) => page.locator('html');
const tab = (page: Page, name: string) => page.locator(`.hq__tab[data-tab="${name}"]`);

test('shows the garage and the upgrade shop, and fits a first upgrade', async ({ page }) => {
  const problems = watchForProblems(page);
  await openCompanyHq(page, '?lang=en');
  await expect(page.locator('.hq__truck-name')).toHaveText('RoadHaul H1 · Box body');

  await tab(page, 'garage').click();
  await expect(tab(page, 'garage')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.truck-card')).toHaveCount(3);
  await expect(page.locator('.truck-card[data-vehicle-id="rh_h1"] .truck-card__status')).toHaveText('Driving it now');
  await expect(page.locator('.truck-card[data-vehicle-id="rh_h2"]')).toContainText('Unlocks at level 2');
  await expect(page.locator('.truck-card[data-vehicle-id="rh_h3"]')).toContainText('Unlocks at level 3');

  await tab(page, 'upgrades').click();
  await expect(page.locator('.upgrade-card')).toHaveCount(5);
  await expect(page.locator('.upgrade-card[data-upgrade-id="suspension"]')).toContainText('Unlocks at level 2');
  const tank = page.locator('.upgrade-card[data-upgrade-id="fuel_tank"]');
  await tank.locator('[data-action="buy-upgrade"]').click();
  await expect(page.locator('.toast')).toContainText('Fuel tank: level 1 fitted.');
  await expect(page.locator('.hq__credits')).toHaveText('3,500 credits');
  await expect(tank).toHaveAttribute('data-level', '1');
  await expect(tank.locator('.pip.is-on')).toHaveCount(1);
  // The bigger tank now has room for more.
  await expect(page.locator('[data-action="refuel"]')).toContainText('Refuel');

  // Back on the job board the next time the HQ opens.
  await page.locator('[data-action="free-drive"]').click();
  await page.locator('[data-action="pause"]').click();
  await page.locator('.pause-menu [data-action="company-hq"]').click();
  await expect(tab(page, 'jobs')).toHaveAttribute('aria-selected', 'true');
  expect(problems).toEqual([]);
});

test('buys the refrigerated truck and drives it, which opens the contracts only it can do', async ({ page }, testInfo) => {
  const problems = watchForProblems(page);
  await continueSavedCompany(page, savedCompany({ credits: 30_000 }), '?lang=en');
  await expect(page.locator('.job-card[data-mission-id="cold_chain"]')).toContainText('Needs the RoadHaul H2');

  await tab(page, 'garage').click();
  const h2 = page.locator('.truck-card[data-vehicle-id="rh_h2"]');
  await h2.locator('[data-action="buy-truck"]').click();
  await expect(page.locator('.hq__credits')).toHaveText('8,000 credits');
  await h2.locator('[data-action="switch-truck"]').click();
  await expect(html(page)).toHaveAttribute('data-vehicle', 'rh_h2');
  await expect(h2.locator('.truck-card__status')).toHaveText('Driving it now');
  await expect(page.locator('.hq__truck-name')).toHaveText('RoadHaul H2 · Refrigerated body');
  await testInfo.attach('garage', { body: await page.screenshot(), contentType: 'image/png' });

  await tab(page, 'jobs').click();
  await expect(page.locator('.job-card[data-mission-id="cold_chain"] [data-action="accept"]')).toBeVisible();
  expect(problems).toEqual([]);
});

test('delivers a contract only the refrigerated truck can do', async ({ page }) => {
  const problems = watchForProblems(page);
  const trucks = [
    { instanceId: 'truck_001', definitionId: 'rh_h1', fuelLiters: 150 },
    { instanceId: 'truck_002', definitionId: 'rh_h2', fuelLiters: 250 },
  ];
  await continueSavedCompany(page, savedCompany({ trucks, activeTruck: 'truck_002' }), '?lang=en&debug');

  await page.locator('.job-card[data-mission-id="cold_chain"] [data-action="accept"]').click();
  await expect(html(page)).toHaveAttribute('data-game-state', 'driving');
  // Debug T parks the truck in the bay it needs next.
  await page.keyboard.press('KeyT');
  await expect(html(page)).toHaveAttribute('data-mission-state', 'loaded', { timeout: 15_000 });
  await page.keyboard.down('ArrowUp');
  await expect(html(page)).toHaveAttribute('data-mission-state', 'delivering', { timeout: 10_000 });
  await page.keyboard.up('ArrowUp');
  await page.keyboard.press('KeyT');
  await expect(page.locator('.result-dialog')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.result-dialog')).toContainText('Cold Chain');
  await page.locator('.result-dialog [data-action="continue"]').click();
  await expect(html(page)).toHaveAttribute('data-game-state', 'companyHq');
  expect(problems).toEqual([]);
});

test('continues with the truck the company was driving, and can switch back', async ({ page }) => {
  const problems = watchForProblems(page);
  const trucks = [
    { instanceId: 'truck_001', definitionId: 'rh_h1', fuelLiters: 150 },
    { instanceId: 'truck_002', definitionId: 'rh_h2', fuelLiters: 200 },
  ];
  await continueSavedCompany(page, savedCompany({ trucks, activeTruck: 'truck_002' }), '?lang=en');

  await expect(html(page)).toHaveAttribute('data-vehicle', 'rh_h2');
  await expect(page.locator('.hq__truck-name')).toHaveText('RoadHaul H2 · Refrigerated body');
  await expect(page.locator('.job-card[data-mission-id="cold_chain"] [data-action="accept"]')).toBeVisible();

  await tab(page, 'garage').click();
  await page.locator('.truck-card[data-vehicle-id="rh_h1"] [data-action="switch-truck"]').click();
  await expect(html(page)).toHaveAttribute('data-vehicle', 'rh_h1');
  await expect(page.locator('.hq__truck-name')).toHaveText('RoadHaul H1 · Box body');
  expect(problems).toEqual([]);
});

test('shows a heavy flatbed with its load', async ({ page }, testInfo) => {
  const problems = watchForProblems(page);
  await continueSavedCompany(page, savedCompany({ credits: 60_000, xp: 3000 }), '?lang=en&debug');

  await tab(page, 'garage').click();
  const h3 = page.locator('.truck-card[data-vehicle-id="rh_h3"]');
  await h3.locator('[data-action="buy-truck"]').click();
  await h3.locator('[data-action="switch-truck"]').click();
  await expect(html(page)).toHaveAttribute('data-vehicle', 'rh_h3');
  await tab(page, 'jobs').click();
  await page.locator('.job-card[data-mission-id="building_site"] [data-action="accept"]').click();
  await page.keyboard.press('KeyT');
  await expect(html(page)).toHaveAttribute('data-mission-state', 'loaded', { timeout: 15_000 });
  await testInfo.attach('loaded flatbed', { body: await page.screenshot(), contentType: 'image/png' });
  expect(problems).toEqual([]);
});

test('paints the truck at the garage for the colour\'s price, after the player confirms, and keeps it', async ({ page }) => {
  const problems = watchForProblems(page);
  await openCompanyHq(page, '?lang=en');
  await tab(page, 'garage').click();
  const picker = page.locator('.truck-card[data-vehicle-id="rh_h1"] .paint-picker');
  const apply = picker.locator('[data-action="paint-truck"]');
  await expect(picker.locator('.paint-picker__label')).toHaveText('Paint: Factory colour');
  await expect(picker.locator('[data-paint-id="factory"]')).toHaveClass(/is-current/);
  await expect(apply).toBeHidden();
  // Colours for bigger companies wait for their level.
  await expect(picker.locator('[data-paint-id="royal_purple"]')).toBeDisabled();

  // A tap only picks the colour: nothing is spent until the button is pressed.
  await picker.locator('[data-paint-id="ocean_blue"]').click();
  await expect(picker.locator('.paint-picker__label')).toHaveText('Paint: Ocean blue');
  await expect(apply).toHaveText('Paint it · 1,500 credits');
  await expect(page.locator('.hq__credits')).toHaveText('5,000 credits');
  await apply.click();
  await expect(page.locator('.toast')).toContainText('RoadHaul H1 painted: Ocean blue.');
  await expect(page.locator('.hq__credits')).toHaveText('3,500 credits');
  await expect(html(page)).toHaveAttribute('data-paint', 'ocean_blue');
  await expect(picker.locator('[data-paint-id="ocean_blue"]')).toHaveClass(/is-current/);

  // Kept in the save: a new visit finds the truck blue.
  await page.reload();
  await page.locator('[data-action="continue-game"]').click();
  await expect(html(page)).toHaveAttribute('data-paint', 'ocean_blue');

  // The factory colour comes back for free.
  await tab(page, 'garage').click();
  await picker.locator('[data-paint-id="factory"]').click();
  await expect(apply).toHaveText('Back to the factory colour');
  await apply.click();
  await expect(html(page)).toHaveAttribute('data-paint', 'factory');
  await expect(page.locator('.hq__credits')).toHaveText('3,500 credits');
  expect(problems).toEqual([]);
});
