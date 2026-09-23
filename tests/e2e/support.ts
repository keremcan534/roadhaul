import { expect, type Page } from '@playwright/test';

/** Collects console errors, console warnings and uncaught exceptions for the whole test. */
export function watchForProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(`console.${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));
  return problems;
}

/** Opens the game and waits until it is booted and driving. */
export async function openGame(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-boot-state', 'ready');
  await expect(html).toHaveAttribute('data-game-state', 'driving');
}

/** Resolves after the browser has produced `count` more animation frames. */
export async function waitForFrames(page: Page, count: number): Promise<void> {
  await page.evaluate(
    (frames) =>
      new Promise<void>((resolve) => {
        let remaining = frames;
        const tick = (): void => {
          remaining--;
          if (remaining <= 0) {
            resolve();
          } else {
            requestAnimationFrame(tick);
          }
        };
        requestAnimationFrame(tick);
      }),
    count,
  );
}

/**
 * Screenshot of the 3D view alone. The HTML overlays are hidden, because a
 * changing speed readout would otherwise make a frozen view look alive.
 */
export async function sceneScreenshot(page: Page): Promise<Buffer> {
  return page.locator('#game-canvas').screenshot({ style: '.touch-controls, .perf-overlay { visibility: hidden !important; }' });
}

/** The speed shown on the on-screen dashboard, km/h. */
export async function shownSpeed(page: Page): Promise<number> {
  return Number(await page.locator('.dashboard__speed').textContent());
}

/** The truck's heading from the `?debug` overlay, degrees from 0 to 360. Turning left increases it. */
export async function shownHeading(page: Page): Promise<number> {
  const text = (await page.locator('.perf-overlay').textContent()) ?? '';
  return Number(/(\d+(?:\.\d+)?)°/.exec(text)?.[1] ?? Number.NaN);
}

/**
 * Grabs the on-screen wheel at the top of its rim and drags it round by
 * `radians` (positive is clockwise), then keeps holding it. Release with
 * `page.mouse.up()`.
 */
export async function turnWheel(page: Page, radians: number): Promise<void> {
  const wheel = await centreOf(page, '.steering-wheel');
  const box = await page.locator('.steering-wheel').boundingBox();
  const radius = (box?.width ?? 100) * 0.42;
  await page.mouse.move(wheel.x, wheel.y - radius);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) {
    const angle = -Math.PI / 2 + (step / 10) * radians;
    await page.mouse.move(wheel.x + Math.cos(angle) * radius, wheel.y + Math.sin(angle) * radius);
  }
}

/** The on-screen steering wheel's rotation, radians. */
export async function wheelRotation(page: Page): Promise<number> {
  const transform = await page.locator('.steering-wheel').evaluate((element) => (element as HTMLElement).style.transform);
  return Number(/rotate\((-?[\d.]+)rad\)/.exec(transform)?.[1] ?? 0);
}

/** Centre of an element, in page coordinates. */
export async function centreOf(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).boundingBox();
  if (box === null) {
    throw new Error(`${selector} is not visible.`);
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
