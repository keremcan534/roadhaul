import { expect, test } from '@playwright/test';
import { openGame, openPanel, watchForProblems } from './support';

test('breaks the news of a fire near the truck: over the job board, in the Gazette, with the rivals\' bosses beside it', async ({ page }, testInfo) => {
  test.slow();
  const problems = watchForProblems(page);
  // Started at once, as soon as the truck is on the road.
  await openGame(page, '?lang=en&city=fire&time=18:30&weather=clear');
  await expect(page.locator('html')).toHaveAttribute('data-city-incident', 'building_fire', { timeout: 15_000 });

  await openPanel(page, 'jobs');
  const ticker = page.locator('[data-value="news-latest"]');
  await expect(ticker).toHaveClass(/is-breaking/);
  await expect(ticker).toContainText('Fire in Havenport! Fire crews and an ambulance are on the scene.');

  await openPanel(page, 'rivals');
  const gazette = page.locator('.hq__section--gazette');
  await expect(gazette.locator('.gazette__item.is-breaking')).toHaveCount(1);
  await expect(gazette.locator('.gazette__item.is-breaking .gazette__text')).toHaveText('Fire in Havenport! Fire crews and an ambulance are on the scene.');
  // The morning paper came out as the game started: two of the quiet days' headlines.
  await expect(gazette.locator('.gazette__item[data-key^="news.flavor."]')).toHaveCount(2);
  await expect(gazette.locator('.gazette__time').first()).toHaveText(/^\d\d:\d\d$/);

  const ironford = page.locator('.rival-card[data-rival-id="rival_demirkent"]');
  await expect(ironford.locator('.rival-card__boss-name')).toHaveText('Boss: Viktor Hale');
  await expect(ironford.locator('.rival-card__personality')).toHaveText('Ruthless');
  await expect(ironford.locator('.rival-card__motto')).toHaveText('“We don’t compete. We win.”');
  await testInfo.attach('gazette', { body: await page.screenshot(), contentType: 'image/png' });
  expect(problems).toEqual([]);
});

test('lets off fireworks and runs a police chase without a problem', async ({ page }) => {
  test.slow();
  const problems = watchForProblems(page);
  await openGame(page, '?lang=en&city=fireworks&time=22:30&weather=clear');
  await expect(page.locator('html')).toHaveAttribute('data-city-incident', 'fireworks', { timeout: 15_000 });
  await page.waitForTimeout(3000);

  await page.goto('about:blank');
  await openGame(page, '?lang=en&city=chase&time=12:00');
  await expect(page.locator('html')).toHaveAttribute('data-city-incident', 'police_chase', { timeout: 15_000 });
  await page.waitForTimeout(3000);
  expect(problems).toEqual([]);
});
