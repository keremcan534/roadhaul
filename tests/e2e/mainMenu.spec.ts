import { expect, test } from '@playwright/test';
import { foundCompany, openMainMenu, openPanel, savedCompany, takeContract, watchForProblems } from './support';

const html = (page: import('@playwright/test').Page) => page.locator('html');

test('shows the saved company on the main menu, and starts the drive at the depot picked', async ({ page }) => {
  test.slow(); // The world is built twice (the menu's, then the company's), drawn in software.
  const problems = watchForProblems(page);
  await page.addInitScript((json) => {
    if (sessionStorage.getItem('roadhaul.e2e.seeded') === null) {
      localStorage.setItem('roadhaul.save', json);
      sessionStorage.setItem('roadhaul.e2e.seeded', 'yes');
    }
  }, savedCompany());
  await openMainMenu(page, '?lang=en');

  const card = page.locator('[data-value="company-card"]');
  await expect(card).toBeVisible();
  await expect(card.locator('.main-menu__card-name')).toHaveText('Kuzey Lojistik');
  await expect(card.locator('.main-menu__card-level')).toHaveText('Level 2');
  await expect(card.locator('.main-menu__card-figures')).toContainText('30,000 credits');
  await expect(card.locator('[data-value="truck-where"]')).toContainText('RoadHaul H1');
  await expect(card.locator('[data-value="contract"]')).toBeHidden();

  // Where the truck was left, first; a depot in each city and the rest area besides.
  const places = page.locator('.main-menu__place');
  await expect(places.first()).toHaveAttribute('data-start', 'left');
  await expect(places.first()).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.main-menu__place[data-kind="depot"]')).toHaveCount(4);
  await expect(page.locator('.main-menu__place[data-kind="restArea"]')).toHaveCount(1);
  const ironford = page.locator('.main-menu__place[data-start="city_b_depot"]');
  await expect(ironford).toHaveText('Ironford depot');
  await ironford.click();
  await expect(ironford).toHaveAttribute('aria-checked', 'true');

  await page.locator('[data-action="continue-game"]').click();
  await expect(html(page)).toHaveAttribute('data-game-state', 'driving');
  await openPanel(page, 'truck');
  await expect(page.locator('.hq__truck-location')).toHaveText('At Ironford depot');
  expect(problems).toEqual([]);
});

test('sets the controls before the drive: they are the ones the road starts with', async ({ page }) => {
  const problems = watchForProblems(page);
  await openMainMenu(page, '?lang=en');

  await page.locator('[data-action="controls"]').click();
  const controls = page.locator('.controls');
  await expect(controls).toBeVisible();
  await controls.locator('[data-steering="buttons"]').click();
  await expect(controls.locator('[data-steering="buttons"]')).toHaveAttribute('aria-checked', 'true');
  await expect(controls.locator('.controls__preview')).toHaveAttribute('data-mode', 'buttons');
  await controls.locator('[data-control-size="large"]').click();
  await expect(controls.locator('.controls__preview')).toHaveAttribute('data-size', 'large');
  await controls.locator('[data-camera="top"]').click();
  await page.locator('[data-action="close-controls"]').click();
  await expect(controls).toBeHidden();

  await foundCompany(page);
  await expect(page.locator('.steer-buttons')).toBeVisible();
  await expect(page.locator('.steering-wheel')).toBeHidden();
  await expect(html(page)).toHaveAttribute('data-camera', 'top');
  expect(problems).toEqual([]);
});

test('keeps the start where the truck is while a contract is under way, and says so', async ({ page }) => {
  test.slow(); // A company founded, then the main menu from the pause menu, drawn in software.
  const problems = watchForProblems(page);
  await openMainMenu(page, '?lang=en');
  await foundCompany(page);
  await openPanel(page, 'jobs');
  await takeContract(page, 'first_package');

  await page.locator('.pause-button').click();
  await page.locator('[data-action="pause-main-menu"]').click();
  await expect(html(page)).toHaveAttribute('data-game-state', 'mainMenu');

  await expect(page.locator('[data-value="contract"]')).toBeVisible();
  await expect(page.locator('.main-menu__start-note')).toBeVisible();
  await expect(page.locator('.main-menu__place').first()).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.main-menu__place[data-kind="depot"]').first()).toBeDisabled();
  await page.locator('[data-action="continue-game"]').click();
  await expect(html(page)).toHaveAttribute('data-game-state', 'driving');
  await expect(html(page)).not.toHaveAttribute('data-mission-state', 'none');
  expect(problems).toEqual([]);
});
