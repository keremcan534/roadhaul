import { expect, test, type Page } from '@playwright/test';
import { openGame, openMainMenu, sceneScreenshot, waitForFrames, watchForProblems } from './support';

/** NPC vehicles on the road, as the game reports them. */
async function trafficCount(page: Page): Promise<number> {
  return Number(await page.locator('html').getAttribute('data-traffic'));
}

test('fills the roads with traffic behind the menu and around the truck', async ({ page }, testInfo) => {
  const problems = watchForProblems(page);

  await openMainMenu(page);
  await expect.poll(() => trafficCount(page), { timeout: 15_000 }).toBe(16);
  await openGame(page);
  await waitForFrames(page, 30);

  expect(await trafficCount(page)).toBe(16);
  await testInfo.attach('traffic', { body: await sceneScreenshot(page), contentType: 'image/png' });
  expect(problems).toEqual([]);
});

test('drives without traffic with ?traffic=0', async ({ page }) => {
  const problems = watchForProblems(page);

  await openGame(page, '?traffic=0');
  await waitForFrames(page, 10);

  expect(await trafficCount(page)).toBe(0);
  expect(problems).toEqual([]);
});
