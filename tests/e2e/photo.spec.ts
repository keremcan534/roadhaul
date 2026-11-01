import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { OPEN_ROAD, openGame, watchForProblems } from './support';

test('takes a photo from the pause menu: the picture alone, turned round the truck, in black and white, saved; back to the menu', async ({
  page,
}, testInfo) => {
  test.slow();
  const problems = watchForProblems(page);
  await openGame(page, `${OPEN_ROAD}&lang=en&time=12:00&weather=clear`);
  const html = page.locator('html');

  await page.locator('.pause-button').click();
  await page.locator('[data-action="pause-photo"]').click();
  await expect(html).toHaveAttribute('data-photo', 'on');
  await expect(page.locator('.photo-mode')).toBeVisible();
  await expect(page.locator('.pause-menu')).toBeHidden();
  // Nothing over the picture but photo mode's own controls.
  await expect(page.locator('.touch-controls')).toBeHidden();
  await expect(page.locator('.minimap')).toBeHidden();
  await expect(page.locator('.photo-mode__hint')).toHaveText('Drag to move round the truck; pinch or scroll to zoom.');

  // A drag turns the camera round the truck.
  const before = await page.locator('#game-canvas').screenshot();
  const stage = await page.locator('.photo-mode__stage').boundingBox();
  await page.mouse.move(stage!.x + stage!.width * 0.6, stage!.y + stage!.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(stage!.x + stage!.width * 0.3, stage!.y + stage!.height * 0.4, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.photo-mode__hint')).toBeHidden();
  await expect.poll(async () => (await page.locator('#game-canvas').screenshot()).equals(before)).toBe(false);

  // The look shows on the canvas as picked.
  await page.locator('[data-action="photo-filter"][data-filter="mono"]').click();
  await expect(page.locator('.photo-mode__look[data-filter="mono"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.photo-mode__look[data-filter="natural"]')).toHaveAttribute('aria-checked', 'false');
  expect(await page.locator('#game-canvas').evaluate((canvas) => canvas.style.filter)).toBe('grayscale(1) contrast(1.12)');

  // Where the browser has no share sheet, the picture downloads, named for when it was taken.
  const downloading = page.waitForEvent('download');
  await page.locator('[data-action="photo-shoot"]').click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^roadhaul-\d{8}-\d{6}\.jpg$/);
  await expect(page.locator('.photo-mode__message')).toHaveText('Photo saved.');
  const file = await readFile((await download.path())!);
  expect([...file.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]); // A JPEG.
  await testInfo.attach('photo', { body: file, contentType: 'image/jpeg' });
  // As big as the game's picture, and in black and white (the brand in its corner aside).
  const picture = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/jpeg;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    // Above the brand in the corner, which keeps its colours.
    const pixels = context.getImageData(0, 0, image.width, Math.floor(image.height * 0.85)).data;
    let colour = 0;
    for (let i = 0; i < pixels.length; i += 4 * 97) {
      colour = Math.max(colour, Math.abs(pixels[i]! - pixels[i + 1]!), Math.abs(pixels[i + 1]! - pixels[i + 2]!));
    }
    const game = document.querySelector<HTMLCanvasElement>('#game-canvas')!;
    return { width: image.width, height: image.height, gameWidth: game.width, gameHeight: game.height, colour };
  }, file.toString('base64'));
  expect([picture.width, picture.height]).toEqual([picture.gameWidth, picture.gameHeight]);
  // JPEG's colour is stored at half resolution: a grey picture comes back within a few levels of grey.
  expect(picture.colour).toBeLessThan(12);

  // Escape (or Android's back) goes back to the pause menu, the canvas as it was.
  await page.keyboard.press('Escape');
  await expect(page.locator('.photo-mode')).toBeHidden();
  await expect(page.locator('.pause-menu')).toBeVisible();
  await expect(html).not.toHaveAttribute('data-photo', /.*/);
  expect(await page.locator('#game-canvas').evaluate((canvas) => canvas.style.filter)).toBe('');
  await page.locator('[data-action="resume"]').click();
  await expect(page.locator('.touch-controls')).toBeVisible();
  expect(problems).toEqual([]);
});
