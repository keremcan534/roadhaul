import { expect, test, type Page } from '@playwright/test';
import { openGame, openMainMenu, openPanel, watchForProblems } from './support';

/** Waits for the game to have booted (again) into the main menu. */
async function booted(page: Page): Promise<void> {
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-boot-state', 'ready');
  await expect(html).toHaveAttribute('data-game-state', 'mainMenu');
}

test('picks a language from the main menu, restarts in it and keeps it', async ({ page }) => {
  test.slow(); // The game booted four times, drawn in software.
  const problems = watchForProblems(page);
  // The phone's own language: English (the test browser's).
  await openMainMenu(page);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('lang', 'en');
  const language = page.locator('[data-action="language"]');
  await expect(language).toContainText('English');

  // The language button opens the settings at the list, which offers the device's language first.
  await language.click();
  const list = page.locator('.settings [data-setting="language"] select');
  await expect(list).toBeVisible();
  await expect(list.locator('option').first()).toHaveText('Device language (English)');
  await expect(list.locator('option')).toHaveCount(11);

  // German: the game starts again, in German.
  await list.selectOption('de');
  await booted(page);
  await expect(html).toHaveAttribute('lang', 'de');
  await expect(page.locator('[data-action="new-company"]')).toHaveText('Neue Firma');
  await expect(page.locator('[data-action="language"]')).toContainText('Deutsch');

  // It is kept: the page opened again, with nothing in its address, speaks German still.
  await page.goto(page.url().replace(/[?&]lang=[^&]*/, ''));
  await booted(page);
  await expect(html).toHaveAttribute('lang', 'de');

  // Back to the phone's own.
  await page.locator('[data-action="language"]').click();
  await page.locator('.settings [data-setting="language"] select').selectOption('auto');
  await booted(page);
  await expect(html).toHaveAttribute('lang', 'en');
  await expect(page.locator('[data-action="new-company"]')).toHaveText('New company');
  expect(problems).toEqual([]);
});

test('boots in each language the address asks for, its table loaded on demand', async ({ page }) => {
  test.slow(); // Ten boots, drawn in software.
  const problems = watchForProblems(page);
  const newCompany: Record<string, string> = {
    id: 'Perusahaan baru',
    de: 'Neue Firma',
    ru: 'Новая компания',
    tr: 'Yeni şirket',
  };
  for (const [code, label] of Object.entries(newCompany)) {
    await openMainMenu(page, `?lang=${code}`);
    await expect(page.locator('html')).toHaveAttribute('lang', code);
    await expect(page.locator('[data-action="new-company"]')).toHaveText(label);
  }
  expect(problems).toEqual([]);
});

test('fits a long language into the company panel of a small phone on its side', async ({ page }) => {
  test.slow(); // A game started, drawn in software.
  const problems = watchForProblems(page);
  await page.setViewportSize({ width: 640, height: 360 });
  await openGame(page, '?lang=fr');
  await openPanel(page, 'events');

  // No tab's name is cut short ("Événements" is made smaller to fit instead), measured to a fraction of a pixel.
  const cut = await page.locator('.hq__tab-label').evaluateAll((labels) =>
    labels
      .filter((label) => {
        const text = document.createRange();
        text.selectNodeContents(label);
        return text.getBoundingClientRect().width > label.getBoundingClientRect().width + 0.5;
      })
      .map((label) => label.textContent),
  );
  expect(cut).toEqual([]);

  // The level ("Niveau 1 · Débutant") stays clear of the credits beside it.
  const level = await page.locator('.hq__level').boundingBox();
  const money = await page.locator('.hq__money').boundingBox();
  expect(level!.x + level!.width).toBeLessThanOrEqual(money!.x + 0.5);
  expect(problems).toEqual([]);
});
