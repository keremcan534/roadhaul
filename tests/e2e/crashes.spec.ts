import { expect, test } from '@playwright/test';
import { openGame, sceneScreenshot, shownSpeed, watchForProblems } from './support';

/**
 * Havenport's harbour road, 45 m east of a street lamp on its verge, facing
 * west along the lamp's line: the truck drives the verge straight into it.
 */
const TOWARD_A_LAMP = '?debug&traffic=0&weather=clear&time=12:00&spawn=-1392,-256.8,-90';
/** The country road from Havenport to Oakhurst, in the lane of the traffic coming the other way. */
const AGAINST_THE_TRAFFIC = '?debug&traffic=24&weather=clear&time=12:00&spawn=-1235.3,826.6,64.5';

test('knocks over the lamp the truck drives into, and drives on', async ({ page }, testInfo) => {
  const problems = watchForProblems(page);
  await openGame(page, TOWARD_A_LAMP);
  const html = page.locator('html');

  await page.keyboard.down('ArrowUp');
  await expect(html).toHaveAttribute('data-knocked-over', /^[1-9]/, { timeout: 60_000 });
  // A lamp post does not stop a truck: it is still under way, not stood against the post.
  await expect.poll(() => shownSpeed(page), { timeout: 10_000 }).toBeGreaterThan(15);
  await testInfo.attach('knocked over', { body: await sceneScreenshot(page), contentType: 'image/png' });
  await page.keyboard.up('ArrowUp');

  expect(problems).toEqual([]);
});

test('wrecks a car it drives into head-on', async ({ page }, testInfo) => {
  const problems = watchForProblems(page);
  await openGame(page, AGAINST_THE_TRAFFIC);
  const html = page.locator('html');

  await page.keyboard.down('ArrowUp');
  await expect(html).toHaveAttribute('data-wrecked', /^[1-9]/, { timeout: 60_000 });
  await testInfo.attach('wrecked', { body: await sceneScreenshot(page), contentType: 'image/png' });
  await page.keyboard.up('ArrowUp');

  expect(problems).toEqual([]);
});
