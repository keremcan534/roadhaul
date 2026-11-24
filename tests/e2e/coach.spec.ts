import { expect, test, type Page } from '@playwright/test';
import { openGame, watchForProblems } from './support';

const html = (page: Page) => page.locator('html');

test('runs the coach line from the coach station: people on, the GPS to the next stop, people off, giving up, and the truck again', async ({
  page,
}) => {
  test.slow();
  const problems = watchForProblems(page);
  // A new company's truck by North Valley's coach station, east of Havenport, parked on its lot.
  await openGame(page, '?debug&lang=en&traffic=0&spawn=-1340,-245,102');
  await page.keyboard.press('KeyG');
  const panel = page.locator('.place-panel');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel).toHaveAttribute('data-kind', 'busStation');
  await expect(panel.locator('.place-panel__name')).toHaveText('Eastgate Coach Station');
  await expect(panel.locator('.place-panel__line')).toContainText('Drive the coach line through 4 towns to Ironford');

  await panel.locator('[data-action="place-action"]').click();
  await expect(html(page)).toHaveAttribute('data-coach', 'on');
  const hud = page.locator('.coach-hud');
  await expect(hud.locator('[data-value="coach-stop"]')).toHaveText('Stop 0/4: Station');
  await expect(hud.locator('[data-value="coach-doors"]')).toHaveText(/^Doors open: \d+ getting on$/);
  await expect(page.locator('.hud-dock')).toBeHidden();
  await expect(panel).toBeHidden();

  // The doors close: the GPS leads to the first town's stop.
  await expect(hud.locator('[data-value="coach-stop"]')).toHaveText(/^Stop 1\/4: Havenport, [\d.,]+ (m|km)$/, { timeout: 30_000 });
  await expect(hud.locator('[data-value="coach-timetable"]')).toHaveText(/^Due in \d+:\d\d$/);
  await expect(hud.locator('[data-value="coach-doors"]')).toBeHidden();
  const onBoard = Number((await hud.locator('[data-value="coach-people"]').textContent())!.split('/')[0]);
  expect(onBoard).toBeGreaterThan(0);

  // At the stop (the debug T key sets the coach down beside it): some off, more on.
  await page.keyboard.press('KeyT');
  await expect(hud.locator('[data-value="coach-stop"]')).toHaveText('Stop 1/4: Havenport', { timeout: 15_000 });
  await expect(hud.locator('[data-value="coach-doors"]')).toHaveText(/^Doors open: \d+ getting off, \d+ getting on$/);

  await hud.locator('[data-action="coach-quit"]').click();
  const result = page.locator('.coach-result');
  await expect(result).toBeVisible();
  await expect(result.locator('.coach-result__title')).toHaveText('You ended the run early.');
  await expect(result.locator('.coach-result__lines')).toContainText('Stops served: 1 of 4');
  await result.locator('[data-action="coach-result-close"]').click();
  await expect(result).toBeHidden();
  await expect(html(page)).toHaveAttribute('data-coach', 'off');
  // In the truck again, at the station.
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-kind', 'busStation');
  expect(problems).toEqual([]);
});
