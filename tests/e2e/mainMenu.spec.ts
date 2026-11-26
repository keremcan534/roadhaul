import { expect, test } from '@playwright/test';
import { continueGame, foundCompany, openMainMenu, openPanel, savedCompany, takeContract, watchForProblems } from './support';

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
  await expect(page.locator('.main-menu__place[data-kind="depot"]')).toHaveCount(7);
  await expect(page.locator('.main-menu__place[data-kind="restArea"]')).toHaveCount(1);
  const ironford = page.locator('.main-menu__place[data-start="city_b_depot"]');
  await expect(ironford).toHaveText('Ironford depot');
  await ironford.click();
  await expect(ironford).toHaveAttribute('aria-checked', 'true');

  await continueGame(page);
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
  await continueGame(page);
  await expect(html(page)).toHaveAttribute('data-game-state', 'driving');
  await expect(html(page)).not.toHaveAttribute('data-mission-state', 'none');
  expect(problems).toEqual([]);
});

test("shows what the update brought, in the player's language, and again from the main menu", async ({ page }) => {
  const problems = watchForProblems(page);
  // A development build tells no one by itself: ?news=1 opens it as an update would, once.
  await openMainMenu(page, '?lang=tr&news=1');
  const dialog = page.locator('.whats-new');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.whats-new__title')).toHaveText('Yenilikler');
  // Google Play's own release notes for the build, in Turkish, and the earlier updates' below them: the patch notes.
  await expect(dialog.locator('[data-value="release-notes"]')).toContainText('akıcı');
  await expect(dialog.locator('[data-value="earlier-notes"] .whats-new__release')).not.toHaveCount(0);
  await expect(dialog.locator('.whats-new__release-title').first()).toHaveText(/^Güncelleme \d+$/);
  await page.locator('[data-action="close-whats-new"]').click();
  await expect(dialog).toBeHidden();

  // Its button on the main menu brings it back.
  await page.locator('[data-action="whats-new"]').click();
  await expect(dialog).toBeVisible();
  await page.locator('[data-action="close-whats-new"]').click();
  await expect(dialog).toBeHidden();
  expect(problems).toEqual([]);
});

test('tells a new player nothing about updates', async ({ page }) => {
  await openMainMenu(page, '?lang=en');
  await expect(page.locator('.whats-new')).toBeHidden();
});
