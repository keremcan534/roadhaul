import { expect, test, type Page } from '@playwright/test';
import { openGame, openMainMenu, waitForFrames, watchForProblems } from './support';

/** Draw calls of the last frame, from the `?debug` overlay. */
async function drawCalls(page: Page): Promise<number> {
  const text = (await page.locator('.perf-overlay').textContent()) ?? '';
  return Number(/(\d+) draws/.exec(text)?.[1] ?? Number.NaN);
}

test('shows a boot screen while the world is built, gone once the game is ready', async ({ page }) => {
  const problems = watchForProblems(page);
  await page.goto('/?lang=en&quality=high');
  // The mark and its moving bar stand in front from the first paint.
  await expect(page.locator('.boot-screen .boot-screen__mark')).toBeAttached();

  await expect(page.locator('html')).toHaveAttribute('data-boot-state', 'ready');
  await expect(page.locator('.boot-screen')).toBeHidden();
  await page.locator('[data-action="settings"]').click();
  await expect(page.locator('.settings')).toBeVisible();
  expect(problems).toEqual([]);
});

test('waits under a note while the graphics are rebuilt, and drives on once they are back', async ({ page }) => {
  test.slow(); // The game started and driven in software, its graphics rebuilt.
  const problems = watchForProblems(page);
  await openGame(page, '?debug&lang=en&traffic=4');
  await waitForFrames(page, 5);
  expect(await drawCalls(page)).toBeGreaterThan(20);

  // The phone takes the GPU back.
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')!;
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const lose = gl!.getExtension('WEBGL_lose_context')!;
    (window as unknown as { loseContext: WEBGL_lose_context }).loseContext = lose;
    lose.loseContext();
  });
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-graphics', 'lost');
  await expect(page.locator('.graphics-notice')).toBeVisible();
  // The drive waits, paused (and saved).
  await expect(page.locator('.pause-menu')).toBeVisible();

  // It is given back: three.js rebuilds the scene.
  await page.evaluate(() => (window as unknown as { loseContext: WEBGL_lose_context }).loseContext.restoreContext());
  await expect(html).toHaveAttribute('data-graphics', 'restored');
  await expect(page.locator('.graphics-notice')).toBeHidden();
  await page.locator('[data-action="resume"]').click();
  await expect(page.locator('.pause-menu')).toBeHidden();
  await waitForFrames(page, 10);
  await expect.poll(() => drawCalls(page)).toBeGreaterThan(20);

  // Calls made to the context while it was gone are refused with a warning: nothing else may go wrong.
  expect(problems.filter((problem) => !problem.includes('CONTEXT_LOST_WEBGL'))).toEqual([]);
});

test('says in the player’s language when the device cannot draw the game, and offers a restart', async ({ page }) => {
  // A phone without WebGL: the canvas gives no 3D context.
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      return type.startsWith('webgl') ? null : (getContext as (...args: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof getContext;
  });
  await page.goto('/?lang=tr');

  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-boot-state', 'error');
  const screen = page.locator('.fatal-error');
  await expect(screen).toBeVisible();
  await expect(screen.locator('.fatal-error__title')).toHaveText('Bir şeyler ters gitti');
  await expect(screen.locator('.fatal-error__note')).toContainText('3B grafiklerini çizemiyor');
  await expect(page.locator('.boot-screen')).toBeHidden();

  // Restart loads the game again (here it fails again the same way).
  await screen.locator('[data-action="restart"]').click();
  await expect(html).toHaveAttribute('data-boot-state', 'error');
  await expect(page.locator('.fatal-error')).toBeVisible();
});

test('tells the game’s version, shows the open-source licences and links the privacy policy in Settings', async ({ page }) => {
  const problems = watchForProblems(page);
  await openMainMenu(page, '?lang=en');
  await page.locator('[data-action="settings"]').click();
  const settings = page.locator('.settings');
  await expect(settings).toBeVisible();

  await expect(settings.locator('.settings__version')).toHaveText(/^Version \d+\.\d+\.\d+ · build \S+$/);
  const privacy = settings.locator('[data-action="privacy-policy"]');
  await expect(privacy).toHaveAttribute('href', 'https://keremcan534.github.io/roadhaul/privacy.html');
  await expect(privacy).toHaveAttribute('target', '_blank');

  await settings.locator('[data-action="licenses"]').click();
  const licenses = settings.locator('.settings__licenses-text');
  await expect(licenses).toBeVisible();
  await expect(licenses).toContainText('three 0.');
  await expect(licenses).toContainText('@capacitor/core');
  await expect(licenses).toContainText('Permission is hereby granted');
  await expect(settings.locator('.settings__about')).toBeHidden();

  await settings.locator('[data-action="close-licenses"]').click();
  await expect(settings.locator('.settings__about')).toBeVisible();
  await expect(licenses).toBeHidden();

  // A touch screen offers to buzz on crashes, and keeps the choice.
  const vibration = settings.locator('[data-setting="vibration"]');
  await expect(vibration).toBeVisible();
  await vibration.locator('[data-vibration="off"]').click();
  await settings.locator('[data-action="close-settings"]').click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-boot-state', 'ready');
  await page.locator('[data-action="settings"]').click();
  await expect(page.locator('[data-setting="vibration"] [data-vibration="off"]')).toHaveAttribute('aria-checked', 'true');
  expect(problems).toEqual([]);
});

test('publishes the privacy policy beside the game, in English and Turkish', async ({ page }) => {
  const problems = watchForProblems(page);
  // Where Settings links to (the game's own site); the page ships in the Android app too.
  await page.goto('/privacy.html');
  await expect(page).toHaveTitle('RoadHaul · Privacy Policy');
  await expect(page.locator('#en')).toContainText('RoadHaul does not collect, keep or share any personal information');
  await expect(page.locator('#tr')).toHaveAttribute('lang', 'tr');
  await expect(page.locator('#tr')).toContainText('RoadHaul hiçbir kişisel bilgi toplamaz, saklamaz ve paylaşmaz');
  expect(problems).toEqual([]);
});
