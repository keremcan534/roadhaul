import { expect, test, type Page } from '@playwright/test';
import { openCompanyHq, openGame, shownSpeed, takeContract, waitForFrames, watchForProblems } from './support';

/** Pixels of a map canvas in one of its colours: the route's blue, or a street's grey. */
async function pixelsOf(page: Page, selector: string, rgb: readonly [number, number, number]): Promise<number> {
  return page.locator(selector).evaluate((element, [red, green, blue]) => {
    const canvas = element as HTMLCanvasElement;
    if (canvas.width === 0 || canvas.height === 0) {
      return 0; // Not sized yet: it sizes itself once shown.
    }
    // Read a copy: reading the game's own canvas again and again makes Chrome warn.
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(canvas, 0, 0);
    const { data } = context.getImageData(0, 0, copy.width, copy.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i]! - red) < 10 && Math.abs(data[i + 1]! - green) < 10 && Math.abs(data[i + 2]! - blue) < 10) {
        count++;
      }
    }
    return count;
  }, rgb);
}

const ROUTE = [46, 155, 255] as const;
const STREET = [163, 173, 184] as const;

async function mapScale(page: Page): Promise<number> {
  return Number(await page.locator('.world-map').getAttribute('data-scale'));
}

test('shows the roads on the minimap, and opens the full map from it with the drive paused', async ({ page }) => {
  const problems = watchForProblems(page);
  await openGame(page);
  const minimap = page.locator('.minimap');
  await expect(minimap).toBeVisible();
  await expect.poll(() => pixelsOf(page, '.minimap__canvas', STREET)).toBeGreaterThan(50);

  await minimap.click();
  const map = page.locator('.world-map');
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute('data-scale', /\d/);
  await expect.poll(() => pixelsOf(page, '.world-map__canvas', STREET)).toBeGreaterThan(200);

  // The drive stands still under the map.
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1_500);
  expect(await shownSpeed(page)).toBe(0);

  const whole = await mapScale(page);
  await page.locator('[data-action="map-zoom-in"]').click();
  await expect.poll(() => mapScale(page)).toBeGreaterThan(whole * 1.5);
  await page.locator('[data-action="map-zoom-out"]').click();
  await expect.poll(() => mapScale(page)).toBeCloseTo(whole, 3);
  await page.locator('[data-action="map-truck"]').click();
  await expect.poll(() => mapScale(page)).toBeGreaterThanOrEqual(0.6);

  // Dragging moves the map.
  const canvas = page.locator('.world-map__canvas');
  const before = await canvas.screenshot();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 + 60, { steps: 5 });
  await page.mouse.up();
  await waitForFrames(page, 3);
  expect((await canvas.screenshot()).equals(before), 'the map did not move').toBe(false);

  // Closed, the drive goes on.
  await page.locator('[data-action="close-map"]').click();
  await expect(map).toBeHidden();
  await expect.poll(() => shownSpeed(page), { timeout: 20_000 }).toBeGreaterThan(5);
  await page.keyboard.up('ArrowUp');
  expect(problems).toEqual([]);
});

test("draws the route to the contract's next bay on both maps", async ({ page }) => {
  const problems = watchForProblems(page);
  await openCompanyHq(page, '?debug');
  await takeContract(page, 'first_package');
  // Loaded at the pickup (T parks there): the route leads 4.4 km to the other city.
  await page.keyboard.press('KeyT');
  await expect(page.locator('html')).toHaveAttribute('data-mission-state', 'loaded', { timeout: 15_000 });
  await expect.poll(() => pixelsOf(page, '.minimap__canvas', ROUTE)).toBeGreaterThan(30);

  await page.keyboard.press('KeyM');
  await expect(page.locator('.world-map')).toBeVisible();
  await expect.poll(() => pixelsOf(page, '.world-map__canvas', ROUTE)).toBeGreaterThan(500);

  // Escape closes the map, and the drive goes on without the pause menu.
  await page.keyboard.press('Escape');
  await expect(page.locator('.world-map')).toBeHidden();
  await expect(page.locator('.pause-menu')).toBeHidden();
  expect(problems).toEqual([]);
});

test('opens the map from the HQ and from the pause menu', async ({ page }) => {
  const problems = watchForProblems(page);
  await openCompanyHq(page);
  await expect(page.locator('.minimap')).toBeHidden();
  await page.locator('[data-action="hq-map"]').click();
  await expect(page.locator('.world-map')).toBeVisible();
  await page.locator('[data-action="close-map"]').click();
  await expect(page.locator('.world-map')).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-game-state', 'companyHq');

  await page.locator('[data-action="free-drive"]').click();
  await page.locator('.pause-button').click();
  await page.locator('[data-action="pause-map"]').click();
  await expect(page.locator('.world-map')).toBeVisible();
  await page.locator('[data-action="close-map"]').click();
  // Back to the pause menu, still paused.
  await expect(page.locator('.pause-menu')).toBeVisible();
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1_000);
  expect(await shownSpeed(page)).toBe(0);
  await page.keyboard.up('ArrowUp');
  expect(problems).toEqual([]);
});
