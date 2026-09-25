import { expect, test } from '@playwright/test';
import {
  centreOf,
  closeSettingsAndResume,
  headingChange,
  openGame,
  openSettingsWhileDriving,
  seedSettings,
  shownHeading,
  shownSpeed,
  tiltPhone,
  watchForProblems,
} from './support';

test('steers by turning the phone once tilt is picked in Settings', async ({ page }) => {
  const problems = watchForProblems(page);
  await openGame(page, '?debug');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-tilt', 'off');

  await openSettingsWhileDriving(page);
  const settings = page.locator('.settings');
  await expect(settings.locator('[data-setting="tilt-sensitivity"]')).toBeHidden();
  await settings.locator('[data-steering="tilt"]').click();
  await expect(settings.locator('[data-steering="tilt"]')).toHaveAttribute('aria-checked', 'true');
  await expect(settings.locator('[data-setting="tilt-sensitivity"]')).toBeVisible();
  // Listening, but nothing has come from the motion sensor yet.
  await expect(html).toHaveAttribute('data-tilt', 'waiting');
  await closeSettingsAndResume(page);

  // The wheel makes way for the tilt button; the brake moves under the left thumb.
  await expect(page.locator('.steering-wheel')).toBeHidden();
  await expect(page.locator('.tilt-button')).toBeVisible();
  const brake = await centreOf(page, '.pedal--brake');
  expect(brake.x).toBeLessThan(page.viewportSize()!.width / 2);

  // The first reading is straight ahead.
  await tiltPhone(page, 0);
  await expect(html).toHaveAttribute('data-tilt', 'on');
  await page.keyboard.down('ArrowUp'); // Gas from the keyboard, steering from the phone.
  await expect.poll(() => shownSpeed(page), { timeout: 20_000 }).toBeGreaterThan(15);

  const straight = await shownHeading(page);
  await tiltPhone(page, 25);
  await expect.poll(async () => -headingChange(straight, await shownHeading(page)), { timeout: 10_000 }).toBeGreaterThan(15);

  const turnedRight = await shownHeading(page);
  await tiltPhone(page, -25);
  await expect.poll(async () => headingChange(turnedRight, await shownHeading(page)), { timeout: 10_000 }).toBeGreaterThan(15);

  await page.keyboard.up('ArrowUp');
  expect(problems).toEqual([]);
});

test('takes the phone as it is held as straight ahead when the tilt button is tapped', async ({ page }) => {
  const problems = watchForProblems(page);
  await seedSettings(page, { steering: 'tilt', tiltSensitivity: 'high' });
  await openGame(page, '?debug');
  await expect(page.locator('html')).toHaveAttribute('data-tilt', 'waiting');
  /** The heading once the overlay (refreshed twice a second) shows it anew: never a reading from before the call. */
  const freshHeading = async (): Promise<number> => {
    const overlay = page.locator('.perf-overlay');
    await expect(overlay).not.toHaveText((await overlay.textContent()) ?? '', { timeout: 5_000 });
    return shownHeading(page);
  };
  /** Heading change over a second or so, degrees: about none while the truck runs straight, 9° or more with a third of full lock. */
  const drift = async (): Promise<number> => {
    const before = await freshHeading();
    await page.waitForTimeout(1_000);
    return Math.abs(headingChange(before, await freshHeading()));
  };

  // Held turned 20° to the right from the start: that is straight ahead. The truck rolls on slowly, straight down its
  // lane until the last check. Turned before, it could reach the verge's lamp posts: under a software renderer the
  // overlay may show a turn a couple of seconds late, and the truck turns on meanwhile.
  await tiltPhone(page, 20);
  await page.keyboard.down('ArrowUp');
  await expect.poll(() => shownSpeed(page), { timeout: 20_000 }).toBeGreaterThan(15);
  await page.keyboard.up('ArrowUp');
  expect(await drift()).toBeLessThan(3);

  // The tilt button tapped with the phone turned 8° further right, a third of full lock: that is straight ahead now.
  await page.locator('.tilt-button').click();
  await tiltPhone(page, 28);
  expect(await drift()).toBeLessThan(3);
  expect(await shownSpeed(page), 'still rolling, so the heading could have turned').toBeGreaterThan(3);

  // Back where straight ahead was before the tap: a gentle left turn now.
  const straight = await shownHeading(page);
  await tiltPhone(page, 20);
  await expect.poll(async () => headingChange(straight, await shownHeading(page)), { timeout: 10_000 }).toBeGreaterThan(3);
  expect(problems).toEqual([]);
});

test('steers with the left and right buttons', async ({ page }) => {
  const problems = watchForProblems(page);
  await seedSettings(page, { steering: 'buttons' });
  await openGame(page, '?debug');
  await expect(page.locator('.steering-wheel')).toBeHidden();
  await expect(page.locator('.tilt-button')).toBeHidden();

  await page.keyboard.down('ArrowUp');
  await expect.poll(() => shownSpeed(page), { timeout: 20_000 }).toBeGreaterThan(15);

  for (const [side, direction] of [
    ['right', -1],
    ['left', 1],
  ] as const) {
    const button = page.locator(`.steer-button--${side}`);
    const centre = await centreOf(page, `.steer-button--${side}`);
    const before = await shownHeading(page);
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await expect(button).toHaveClass(/is-pressed/);
    await expect.poll(async () => direction * headingChange(before, await shownHeading(page)), { timeout: 10_000 }).toBeGreaterThan(15);
    await page.mouse.up();
    await expect(button).not.toHaveClass(/is-pressed/);
  }

  await page.keyboard.up('ArrowUp');
  expect(problems).toEqual([]);
});

test('draws the controls in the size picked, and remembers the controls picked', async ({ page }) => {
  const problems = watchForProblems(page);
  await openGame(page);
  const width = async (): Promise<number> => (await page.locator('.steering-wheel').boundingBox())!.width;
  const normal = await width();

  await openSettingsWhileDriving(page);
  await page.locator('.settings [data-control-size="large"]').click();
  await page.locator('.settings [data-steering="buttons"]').click();
  await page.locator('.settings [data-steering="wheel"]').click();
  await closeSettingsAndResume(page);
  expect(await width()).toBeGreaterThan(normal * 1.1);

  await openSettingsWhileDriving(page);
  await page.locator('.settings [data-control-size="small"]').click();
  await page.locator('.settings [data-steering="buttons"]').click();
  await closeSettingsAndResume(page);
  await expect(page.locator('.steer-buttons')).toBeVisible();

  // Kept on the phone: a new visit starts with them.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-game-state', 'mainMenu');
  await page.locator('[data-action="settings"]').click();
  await expect(page.locator('.settings [data-steering="buttons"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.settings [data-control-size="small"]')).toHaveAttribute('aria-checked', 'true');
  expect(problems).toEqual([]);
});
