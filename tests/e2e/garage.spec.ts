import { expect, test, type Page } from '@playwright/test';
import {
  closePanel,
  continueSavedCompany,
  openGame,
  openPanel,
  savedCompany,
  takeContract,
  watchForProblems,
} from './support';

const html = (page: Page) => page.locator('html');
const tab = (page: Page, name: string) => page.locator(`.hq__tab[data-tab="${name}"]`);
/** What the truck in the world is built from (TruckView.key): model, paint, and the level of each upgraded part. */
const truckView = (page: Page) => html(page).getAttribute('data-truck-view');

test('shows the garage with its upgrades, and fits a first upgrade that shows on the truck', async ({ page }) => {
  const problems = watchForProblems(page);
  await openGame(page, '?lang=en');
  await openPanel(page, 'truck');
  await expect(page.locator('.hq__truck-name')).toHaveText('RoadHaul H1 · Box body');

  await openPanel(page, 'garage');
  await expect(page.locator('.truck-card')).toHaveCount(3);
  await expect(page.locator('.truck-card[data-vehicle-id="rh_h1"] .truck-card__status')).toHaveText('Driving it now');
  await expect(page.locator('.truck-card[data-vehicle-id="rh_h2"]')).toContainText('Unlocks at level 2');
  await expect(page.locator('.truck-card[data-vehicle-id="rh_h3"]')).toContainText('Unlocks at level 3');

  await expect(page.locator('.upgrade-card')).toHaveCount(5);
  await expect(page.locator('.upgrade-card[data-upgrade-id="suspension"]')).toContainText('Unlocks at level 2');
  expect(await truckView(page)).toContain(':00000:');
  const tank = page.locator('.upgrade-card[data-upgrade-id="fuel_tank"]');
  await tank.locator('[data-action="buy-upgrade"]').click();
  await expect(page.locator('.toast')).toContainText('Fuel tank: level 1 fitted.');
  await expect(page.locator('.hq__credits')).toHaveText('3,500 credits');
  await expect(tank).toHaveAttribute('data-level', '1');
  await expect(tank.locator('.pip.is-on')).toHaveCount(1);
  // The bigger tank is on the truck, with room for more fuel.
  await expect(html(page)).toHaveAttribute('data-truck-view', /:00001:/);
  await openPanel(page, 'truck');
  await expect(page.locator('.truck-part[data-upgrade-id="fuel_tank"]')).toHaveClass(/is-fitted/);
  await expect(page.locator('[data-action="refuel"]')).toContainText('Refuel');

  // Each of the road's buttons opens the panel on its own page.
  await closePanel(page);
  await page.locator('[data-action="dock-jobs"]').click();
  await expect(tab(page, 'jobs')).toHaveAttribute('aria-selected', 'true');
  expect(problems).toEqual([]);
});

test('shows a paint, an upgrade or another truck on the truck before it is bought, and puts it back', async ({ page }) => {
  const problems = watchForProblems(page);
  await openGame(page, '?lang=en');
  await openPanel(page, 'garage');
  const asItIs = await truckView(page);
  expect(asItIs).toMatch(/^rh_h1:.*:00000:/);

  const engine = page.locator('.upgrade-card[data-upgrade-id="engine"]');
  await engine.locator('[data-action="preview-upgrade"]').click();
  await expect(html(page)).toHaveAttribute('data-truck-view', /^rh_h1:.*:10000:/);
  await expect(engine).toHaveClass(/is-previewing/);
  await expect(engine.locator('[data-action="preview-upgrade"]')).toHaveAttribute('aria-pressed', 'true');
  // A second tap puts the truck back as it is.
  await engine.locator('[data-action="preview-upgrade"]').click();
  await expect(html(page)).toHaveAttribute('data-truck-view', asItIs!);
  await expect(engine).not.toHaveClass(/is-previewing/);

  await page.locator('.truck-card[data-vehicle-id="rh_h2"] [data-action="preview-truck"]').click();
  await expect(html(page)).toHaveAttribute('data-truck-view', /^rh_h2:/);
  // Nothing was bought, and the truck being driven is still the same.
  await expect(html(page)).toHaveAttribute('data-vehicle', 'rh_h1');
  await expect(page.locator('.hq__credits')).toHaveText('5,000 credits');

  // Back on the road, the truck is as it is.
  await closePanel(page);
  await expect(html(page)).toHaveAttribute('data-truck-view', asItIs!);
  expect(problems).toEqual([]);
});

test('buys the refrigerated truck and drives it, which opens the contracts only it can do', async ({ page }, testInfo) => {
  const problems = watchForProblems(page);
  await continueSavedCompany(page, savedCompany({ credits: 30_000 }), '?lang=en');
  await openPanel(page, 'jobs');
  await expect(page.locator('.job-card[data-mission-id="cold_chain"]')).toContainText('Needs the RoadHaul H2');

  await openPanel(page, 'garage');
  const h2 = page.locator('.truck-card[data-vehicle-id="rh_h2"]');
  await h2.locator('[data-action="buy-truck"]').click();
  await expect(page.locator('.hq__credits')).toHaveText('8,000 credits');
  await h2.locator('[data-action="switch-truck"]').click();
  await expect(html(page)).toHaveAttribute('data-vehicle', 'rh_h2');
  await expect(h2.locator('.truck-card__status')).toHaveText('Driving it now');
  await testInfo.attach('garage', { body: await page.screenshot(), contentType: 'image/png' });
  await openPanel(page, 'truck');
  await expect(page.locator('.hq__truck-name')).toHaveText('RoadHaul H2 · Refrigerated body');

  await openPanel(page, 'jobs');
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

  await openPanel(page, 'jobs');
  await takeContract(page, 'cold_chain');
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
  await expect(page.locator('.result-dialog')).toBeHidden();
  await expect(html(page)).toHaveAttribute('data-game-state', 'driving');
  await expect(page.locator('[data-action="dock-jobs"]')).toBeVisible();
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
  await openPanel(page, 'truck');
  await expect(page.locator('.hq__truck-name')).toHaveText('RoadHaul H2 · Refrigerated body');
  await openPanel(page, 'jobs');
  await expect(page.locator('.job-card[data-mission-id="cold_chain"] [data-action="accept"]')).toBeVisible();

  await openPanel(page, 'garage');
  await page.locator('.truck-card[data-vehicle-id="rh_h1"] [data-action="switch-truck"]').click();
  await expect(html(page)).toHaveAttribute('data-vehicle', 'rh_h1');
  await openPanel(page, 'truck');
  await expect(page.locator('.hq__truck-name')).toHaveText('RoadHaul H1 · Box body');
  expect(problems).toEqual([]);
});

test('shows a heavy flatbed with its load', async ({ page }, testInfo) => {
  const problems = watchForProblems(page);
  await continueSavedCompany(page, savedCompany({ credits: 60_000, xp: 3000 }), '?lang=en&debug');

  await openPanel(page, 'garage');
  const h3 = page.locator('.truck-card[data-vehicle-id="rh_h3"]');
  await h3.locator('[data-action="buy-truck"]').click();
  await h3.locator('[data-action="switch-truck"]').click();
  await expect(html(page)).toHaveAttribute('data-vehicle', 'rh_h3');
  await openPanel(page, 'jobs');
  await takeContract(page, 'building_site');
  await page.keyboard.press('KeyT');
  await expect(html(page)).toHaveAttribute('data-mission-state', 'loaded', { timeout: 15_000 });
  await testInfo.attach('loaded flatbed', { body: await page.screenshot(), contentType: 'image/png' });
  expect(problems).toEqual([]);
});

test('paints the truck at the garage for the colour\'s price, after the player confirms, and keeps it', async ({ page }) => {
  const problems = watchForProblems(page);
  await openGame(page, '?lang=en');
  await openPanel(page, 'garage');
  const picker = page.locator('.hq__section--paint .paint-picker');
  const apply = picker.locator('[data-action="paint-truck"]');
  await expect(picker.locator('.paint-picker__label')).toHaveText('Paint: Factory colour');
  await expect(picker.locator('[data-paint-id="factory"]')).toHaveClass(/is-current/);
  await expect(apply).toBeHidden();
  // Colours for bigger companies wait for their level.
  await expect(picker.locator('[data-paint-id="royal_purple"]')).toBeDisabled();

  // A tap only picks the colour and shows it on the truck: nothing is spent until the button is pressed.
  await picker.locator('[data-paint-id="ocean_blue"]').click();
  await expect(picker.locator('.paint-picker__label')).toHaveText('Paint: Ocean blue');
  await expect(html(page)).toHaveAttribute('data-truck-view', /^rh_h1:2b6cb0:/);
  await expect(html(page)).toHaveAttribute('data-paint', 'factory');
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
  await expect(html(page)).toHaveAttribute('data-truck-view', /^rh_h1:2b6cb0:/);

  // The factory colour comes back for free.
  await openPanel(page, 'garage');
  await picker.locator('[data-paint-id="factory"]').click();
  await expect(apply).toHaveText('Back to the factory colour');
  await apply.click();
  await expect(html(page)).toHaveAttribute('data-paint', 'factory');
  await expect(page.locator('.hq__credits')).toHaveText('3,500 credits');
  expect(problems).toEqual([]);
});
