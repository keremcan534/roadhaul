import { expect, test, type Page } from '@playwright/test';
import {
  centreOf,
  closeSettingsAndResume,
  openGame,
  openSettingsWhileDriving,
  seedSettings,
  shownSpeed,
  watchForProblems,
} from './support';

const COMMON_CONTROLS = [
  '.pedal--gas',
  '.pedal--brake',
  '.gear-button',
  '.dashboard',
  '.camera-button',
  '.horn-button',
  '.pause-button',
  '.minimap',
  '.hud-dock',
];
/** The controls each way of steering (Settings) adds. */
const STEERING_CONTROLS = {
  wheel: ['.steering-wheel'],
  tilt: ['.tilt-button'],
  buttons: ['.steer-button--left', '.steer-button--right'],
} as const;
const VIEWPORTS = {
  landscape: null, // The project's phone, on its side.
  portrait: { width: 412, height: 839 }, // Pixel 7 held upright.
  'narrow portrait': { width: 360, height: 740 }, // Smaller Android phones.
} as const;

/** Every control is on screen, and none covers another. */
async function expectLaidOut(page: Page, controls: readonly string[], context: string): Promise<void> {
  const viewport = page.viewportSize()!;
  const boxes = await Promise.all(controls.map((selector) => page.locator(selector).boundingBox()));
  boxes.forEach((box, index) => {
    expect(box, `${controls[index]} is not shown (${context})`).not.toBeNull();
    expect(box!.x, context).toBeGreaterThanOrEqual(0);
    expect(box!.y, context).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, context).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height, context).toBeLessThanOrEqual(viewport.height);
  });
  for (let a = 0; a < boxes.length; a++) {
    for (let b = a + 1; b < boxes.length; b++) {
      const first = boxes[a]!;
      const second = boxes[b]!;
      const overlap =
        first.x < second.x + second.width &&
        second.x < first.x + first.width &&
        first.y < second.y + second.height &&
        second.y < first.y + first.height;
      expect(overlap, `${controls[a]} overlaps ${controls[b]} (${context})`).toBe(false);
    }
  }
}

for (const [orientation, viewport] of Object.entries(VIEWPORTS)) {
  for (const steering of ['wheel', 'tilt', 'buttons'] as const) {
    test(`lays out the ${steering} controls in every size without overlaps, ${orientation}`, async ({ page }) => {
      test.slow(); // The game started, and the settings opened and closed twice, drawn in software.
      const problems = watchForProblems(page);
      if (viewport !== null) {
        await page.setViewportSize(viewport);
      }
      await seedSettings(page, { steering });
      await openGame(page);

      const controls = [...STEERING_CONTROLS[steering], ...COMMON_CONTROLS];
      await expectLaidOut(page, controls, 'normal size');
      for (const size of ['small', 'large'] as const) {
        await openSettingsWhileDriving(page);
        await page.locator(`.settings [data-control-size="${size}"]`).click();
        await closeSettingsAndResume(page);
        await expectLaidOut(page, controls, `${size} size`);
      }
      expect(problems).toEqual([]);
    });
  }
}

test('keeps a pedal pressed until the last finger on it lifts', async ({ page }) => {
  const problems = watchForProblems(page);
  await openGame(page);
  const gas = page.locator('.pedal--gas');
  const centre = await centreOf(page, '.pedal--gas');
  // Count lifted fingers, so the test cannot pass without actually lifting one.
  await gas.evaluate((pedal) =>
    pedal.addEventListener('pointerup', () =>
      pedal.setAttribute('data-test-lifts', String(Number(pedal.getAttribute('data-test-lifts') ?? 0) + 1)),
    ),
  );
  // Real multi-touch through the DevTools protocol. In Chromium, touchStart adds the new points
  // and touchEnd lifts exactly the points it lists (all of them when it lists none).
  const cdp = await page.context().newCDPSession(page);
  const thumb = { x: centre.x, y: centre.y - 15, id: 1 };
  const finger = { x: centre.x, y: centre.y + 15, id: 2 };
  const touch = (type: 'touchStart' | 'touchEnd', touchPoints: (typeof thumb)[]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints });

  await touch('touchStart', [thumb]);
  await touch('touchStart', [thumb, finger]);
  await expect(gas).toHaveClass(/is-pressed/);
  await touch('touchEnd', [finger]);
  await expect(gas).toHaveAttribute('data-test-lifts', '1');

  // The thumb is still down: the pedal stays pressed and the truck keeps accelerating.
  await expect(gas).toHaveClass(/is-pressed/);
  await expect.poll(() => shownSpeed(page), { timeout: 20_000 }).toBeGreaterThan(10);
  await expect(gas).toHaveClass(/is-pressed/);

  await touch('touchEnd', []);
  await expect(gas).toHaveAttribute('data-test-lifts', '2');
  await expect(gas).not.toHaveClass(/is-pressed/);
  expect(problems).toEqual([]);
});
