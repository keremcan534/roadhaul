import { expect, test } from '@playwright/test';
import { openGame, OPEN_ROAD, sceneScreenshot, shownSpeed, watchForProblems } from './support';

test('rolls the truck over in a turn held too fast, and puts it back on its wheels', async ({ page }, testInfo) => {
  test.slow(); // It drives up to speed, goes over and comes to rest, drawn in software.
  const problems = watchForProblems(page);
  await openGame(page, OPEN_ROAD);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-attitude', 'wheels');

  // Flat out to highway speed (in town the truck corners well inside its rollover threshold), then the wheel hard
  // over and held: up on two wheels, then over.
  await page.keyboard.down('ArrowUp');
  await expect.poll(() => shownSpeed(page), { timeout: 90_000 }).toBeGreaterThan(65);
  await page.keyboard.down('ArrowRight');
  await expect(html).toHaveAttribute('data-attitude', 'tipping', { timeout: 20_000 });
  await expect(html).toHaveAttribute('data-attitude', 'overturned', { timeout: 20_000 });
  await expect(html).toHaveAttribute('data-overturns', '1');
  await page.keyboard.up('ArrowRight');

  // Once it has come to rest, the way back onto its wheels; the gas does nothing meanwhile.
  const recover = page.locator('[data-action="recover-truck"]');
  await expect(recover).toBeVisible({ timeout: 30_000 });
  await expect(html).toHaveAttribute('data-attitude', 'overturned');
  await testInfo.attach('overturned', { body: await sceneScreenshot(page), contentType: 'image/png' });
  await page.keyboard.up('ArrowUp');
  await recover.click();

  await expect(html).toHaveAttribute('data-attitude', 'wheels');
  await expect(page.locator('.rollover-panel')).toBeHidden();
  await page.keyboard.down('ArrowUp');
  await expect.poll(() => shownSpeed(page), { timeout: 20_000 }).toBeGreaterThan(5);
  await page.keyboard.up('ArrowUp');
  expect(problems).toEqual([]);
});
