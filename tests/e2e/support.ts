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

/**
 * The game's calendar date in the tests (`?date=`), unless a test picks
 * another: before the first special event starts, so no event bonus changes
 * what a delivery pays.
 */
export const QUIET_DATE = '2025-12-01';

export interface OpenOptions {
  /** The date the game's calendar starts at: 'YYYY-MM-DD', or an ISO 8601 date and time. */
  readonly date?: string;
}

/**
 * Opens the game and waits until it has booted into the main menu. The
 * graphics preset is high unless the query picks one, so what the tests
 * count (traffic, draw calls) does not depend on the machine running them.
 */
export async function openMainMenu(page: Page, query = '', options: OpenOptions = {}): Promise<void> {
  const parameters = new URLSearchParams(query);
  parameters.set('date', options.date ?? QUIET_DATE);
  if (!parameters.has('quality')) {
    parameters.set('quality', 'high');
  }
  await page.goto(`/?${parameters.toString()}`);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-boot-state', 'ready');
  await expect(html).toHaveAttribute('data-game-state', 'mainMenu');
}

/** Founds a company from the main menu, which opens its HQ. */
export async function foundCompany(page: Page, name = 'Test Lojistik'): Promise<void> {
  await page.locator('[data-action="new-company"]').click();
  await page.locator('.new-company__input').fill(name);
  await page.locator('[data-action="start-company"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-game-state', 'companyHq');
}

/** One owned truck as the game saves it. */
export interface SavedTruck {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly fuelLiters: number;
}

/** A company as the game saves it, part way up the ladder: level 2, with credits for a truck. */
export function savedCompany(
  overrides: { credits?: number; xp?: number; trucks?: readonly SavedTruck[]; activeTruck?: string } = {},
): string {
  const xp = overrides.xp ?? 1000;
  const trucks = overrides.trucks ?? [{ instanceId: 'truck_001', definitionId: 'rh_h1', fuelLiters: 150 }];
  return JSON.stringify({
    version: 4,
    createdAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_000_000,
    profile: { companyName: 'Kuzey Lojistik' },
    company: { level: xp >= 3000 ? 3 : xp >= 1000 ? 2 : 1, xp, reputation: 40 },
    economy: { credits: overrides.credits ?? 30_000 },
    garage: {
      activeVehicleInstanceId: overrides.activeTruck ?? trucks[0]!.instanceId,
      vehicles: trucks.map((truck) => ({ ...truck, damage: 0, upgrades: {} })),
    },
    world: { mapId: 'north_valley', truck: null },
    missions: { active: null },
    stats: { deliveriesCompleted: 9, deliveriesFailed: 0, creditsEarned: 12_000, distanceDrivenMeters: 9_000 },
  });
}

/** Opens the game with `save` in storage and continues it: its HQ. */
export async function continueSavedCompany(page: Page, save: string, query = '', options: OpenOptions = {}): Promise<void> {
  await page.addInitScript((json) => {
    if (sessionStorage.getItem('roadhaul.e2e.seeded') === null) {
      localStorage.setItem('roadhaul.save', json);
      sessionStorage.setItem('roadhaul.e2e.seeded', 'yes');
    }
  }, save);
  await openMainMenu(page, query, options);
  await page.locator('[data-action="continue-game"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-game-state', 'companyHq');
}

/** Opens the game and founds a new company: its HQ. */
export async function openCompanyHq(page: Page, query = '', options: OpenOptions = {}): Promise<void> {
  await openMainMenu(page, query, options);
  await foundCompany(page);
}

/** Opens the game and drives off without a contract: Play, then Free drive. */
export async function openGame(page: Page, query = '', options: OpenOptions = {}): Promise<void> {
  await openCompanyHq(page, query, options);
  await page.locator('[data-action="free-drive"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-game-state', 'driving');
}

/** Takes a contract from the job board by its mission id. */
export async function takeContract(page: Page, missionId: string): Promise<void> {
  await page.locator(`.job-card[data-mission-id="${missionId}"] [data-action="accept"]`).click();
  await expect(page.locator('html')).toHaveAttribute('data-game-state', 'driving');
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
  return page.locator('#game-canvas').screenshot({
    style: '.touch-controls, .perf-overlay, .mission-hud, .pause-button { visibility: hidden !important; }',
  });
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

/** Signed change from heading `from` to heading `to`, degrees in (-180, 180]: positive is a left turn. */
export function headingChange(from: number, to: number): number {
  const change = (((to - from) % 360) + 360) % 360;
  return change > 180 ? change - 360 : change;
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
