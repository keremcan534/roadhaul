import { expect, test, type Page } from '@playwright/test';
import { openGame, openMainMenu, sceneScreenshot, waitForFrames, watchForProblems } from './support';

/** Mean brightness of the scene (0..255), decoded in the page from a screenshot of the canvas. */
async function sceneBrightness(page: Page): Promise<number> {
  const png = (await sceneScreenshot(page)).toString('base64');
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      sum += 0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!;
    }
    return sum / (pixels.length / 4);
  }, png);
}

test('starts the weather given with ?weather=, and draws the rain', async ({ page }, testInfo) => {
  const problems = watchForProblems(page);

  await openGame(page, '?weather=rain');
  await waitForFrames(page, 30);

  await expect(page.locator('html')).toHaveAttribute('data-weather', 'rain');
  await testInfo.attach('rain', { body: await sceneScreenshot(page), contentType: 'image/png' });
  expect(problems).toEqual([]);
});

test('darkens the world at night, with the lamps and headlights lit', async ({ page }, testInfo) => {
  const problems = watchForProblems(page);

  await openGame(page, '?weather=clear');
  await waitForFrames(page, 10);
  const day = await sceneBrightness(page);
  // The same company, the same truck, the same place: at night.
  await openMainMenu(page, '?weather=night');
  await page.locator('[data-action="continue-game"]').click();
  await page.locator('[data-action="free-drive"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-game-state', 'driving');
  await waitForFrames(page, 10);
  const night = await sceneBrightness(page);

  await expect(page.locator('html')).toHaveAttribute('data-weather', 'night');
  await testInfo.attach('night', { body: await sceneScreenshot(page), contentType: 'image/png' });
  expect(night).toBeLessThan(day * 0.5);
  expect(night).toBeGreaterThan(5); // Dark, not black.
  expect(problems).toEqual([]);
});
