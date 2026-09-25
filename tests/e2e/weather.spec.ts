import { expect, test, type Page } from '@playwright/test';
import {
  closeSettingsAndResume,
  openGame,
  openMainMenu,
  openSettingsWhileDriving,
  sceneScreenshot,
  waitForFrames,
  watchForProblems,
} from './support';

interface SceneColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Mean colour of the scene (0..255 a channel), decoded in the page from a screenshot of the canvas. */
async function sceneColor(page: Page): Promise<SceneColor> {
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
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      r += pixels[i]!;
      g += pixels[i + 1]!;
      b += pixels[i + 2]!;
    }
    const count = pixels.length / 4;
    return { r: r / count, g: g / count, b: b / count };
  }, png);
}

/** How bright a colour looks (0..255). */
function brightness(color: SceneColor): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

/** Drives the same company's truck from the main menu, opened in the `weather` given (or dawn, dusk, night). */
async function driveIn(page: Page, weather: string): Promise<void> {
  await openMainMenu(page, `?weather=${weather}`);
  await page.locator('[data-action="continue-game"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-game-state', 'driving');
  await waitForFrames(page, 10);
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
  test.setTimeout(60_000); // The game started twice, drawn in software.
  const problems = watchForProblems(page);

  await openGame(page, '?weather=clear');
  await waitForFrames(page, 10);
  const day = brightness(await sceneColor(page));
  // The same company, the same truck, the same place: at night.
  await driveIn(page, 'night');
  const night = brightness(await sceneColor(page));

  // Night is a time of day, apart from the weather: a clear night.
  await expect(page.locator('html')).toHaveAttribute('data-daylight', 'night');
  await expect(page.locator('html')).toHaveAttribute('data-weather', 'clear');
  await testInfo.attach('night', { body: await sceneScreenshot(page), contentType: 'image/png' });
  expect(night).toBeLessThan(day * 0.5);
  expect(night).toBeGreaterThan(5); // Dark, not black.
  expect(problems).toEqual([]);
});

test('turns the light warm at dusk, with the sun low in a glowing sky', async ({ page }, testInfo) => {
  test.setTimeout(60_000); // The game started twice, drawn in software.
  const problems = watchForProblems(page);

  await openGame(page, '?weather=clear');
  await waitForFrames(page, 10);
  const day = await sceneColor(page);
  await driveIn(page, 'dusk');
  const dusk = await sceneColor(page);

  await expect(page.locator('html')).toHaveAttribute('data-daylight', 'dusk');
  await testInfo.attach('dusk', { body: await sceneScreenshot(page), contentType: 'image/png' });
  expect(dusk.r / dusk.b).toBeGreaterThan((day.r / day.b) * 1.3);
  expect(brightness(dusk)).toBeLessThan(brightness(day));
  expect(problems).toEqual([]);
});

test('sets the time of day from Settings: night falls at once, the minimap shows the time, and it is kept', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000); // The game started twice, drawn in software.
  const problems = watchForProblems(page);
  await openGame(page, '?weather=clear');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-daylight', 'day');
  await waitForFrames(page, 10);
  const day = brightness(await sceneColor(page));

  await openSettingsWhileDriving(page);
  const settings = page.locator('.settings');
  await settings.locator('[data-time-flow="stopped"]').click();
  await settings.locator('[data-clock="night"]').click();
  await expect(settings.locator('[data-clock="night"]')).toHaveAttribute('aria-checked', 'true');
  const time = (await settings.locator('.settings__clock-time').textContent()) ?? '';
  expect(time).toMatch(/^\d\d:\d\d$/);
  await closeSettingsAndResume(page);

  await expect(html).toHaveAttribute('data-daylight', 'night');
  await expect(page.locator('.minimap__clock')).toHaveText(time);
  await waitForFrames(page, 10);
  expect(brightness(await sceneColor(page))).toBeLessThan(day * 0.5);
  await testInfo.attach('night from settings', { body: await sceneScreenshot(page), contentType: 'image/png' });

  // Kept on the phone, standing still: a new visit starts at that time.
  await page.reload();
  await expect(html).toHaveAttribute('data-boot-state', 'ready');
  await expect(html).toHaveAttribute('data-daylight', 'night');
  expect(problems).toEqual([]);
});
