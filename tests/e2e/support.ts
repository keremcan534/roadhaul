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

/** Founds a company from the main menu, which goes straight into the game: the truck waits on the road. */
export async function foundCompany(page: Page, name = 'Test Lojistik'): Promise<void> {
  await page.locator('[data-action="new-company"]').click();
  await page.locator('.new-company__input').fill(name);
  await page.locator('[data-action="start-company"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-game-state', 'driving');
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

/** Opens the game with `save` in storage and continues it: into the game. */
export async function continueSavedCompany(page: Page, save: string, query = '', options: OpenOptions = {}): Promise<void> {
  await page.addInitScript((json) => {
    if (sessionStorage.getItem('roadhaul.e2e.seeded') === null) {
      localStorage.setItem('roadhaul.save', json);
      sessionStorage.setItem('roadhaul.e2e.seeded', 'yes');
    }
  }, save);
  await openMainMenu(page, query, options);
  await page.locator('[data-action="continue-game"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-game-state', 'driving');
}

/** The company panel's pages. */
export type PanelTab = 'jobs' | 'truck' | 'garage' | 'events';

/**
 * Opens the company panel on `tab`: from its button on the road, or (with a
 * contract under way, when the job board's button is gone, or with the panel
 * open) through its tabs.
 */
export async function openPanel(page: Page, tab: PanelTab = 'jobs'): Promise<void> {
  const html = page.locator('html');
  if ((await html.getAttribute('data-panel')) !== 'open') {
    const button = page.locator(`[data-action="dock-${tab}"]`);
    await (tab === 'jobs' && !(await button.isVisible()) ? page.locator('[data-action="dock-truck"]') : button).click();
    await expect(html).toHaveAttribute('data-panel', 'open');
  }
  const tabButton = page.locator(`.hq__tab[data-tab="${tab}"]`);
  if ((await tabButton.getAttribute('aria-selected')) !== 'true') {
    await tabButton.click();
  }
  await expect(tabButton).toHaveAttribute('aria-selected', 'true');
}

/** Closes the company panel: back on the road. */
export async function closePanel(page: Page): Promise<void> {
  await page.locator('[data-action="close-hq"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-panel', 'none');
}

/** Opens the game, founds a new company and opens its job board over the road. */
export async function openCompanyHq(page: Page, query = '', options: OpenOptions = {}): Promise<void> {
  await openMainMenu(page, query, options);
  await foundCompany(page);
  await openPanel(page, 'jobs');
}

/**
 * The debug overlay, no traffic, and the truck started on the open highway
 * east of the rest area, heading east: room to turn either way at speed.
 * In town, a truck turning across the high street reaches the benches and
 * lamp posts on its pavements, and cars.
 */
export const OPEN_ROAD = '?debug&traffic=0&spawn=300,-641,84';

/** Opens the game with a new company: on the road, without a contract. */
export async function openGame(page: Page, query = '', options: OpenOptions = {}): Promise<void> {
  await openMainMenu(page, query, options);
  await foundCompany(page);
}

/** Takes a contract from the job board by its mission id: the panel closes, and the truck is on its way. */
export async function takeContract(page: Page, missionId: string): Promise<void> {
  await page.locator(`.job-card[data-mission-id="${missionId}"] [data-action="accept"]`).click();
  await expect(page.locator('html')).toHaveAttribute('data-panel', 'none');
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

/** Device settings (Settings dialog) stored before the game opens, as the game keeps them. Set once per test. */
export async function seedSettings(page: Page, settings: Readonly<Record<string, string | boolean>>): Promise<void> {
  await page.addInitScript((json) => {
    if (sessionStorage.getItem('roadhaul.e2e.settings') === null) {
      localStorage.setItem('roadhaul.settings', json);
      sessionStorage.setItem('roadhaul.e2e.settings', 'yes');
    }
  }, JSON.stringify(settings));
}

/**
 * Sends the page a motion sensor reading (gravity included, m/s²) for a
 * phone held on its side, top to the left, tipped back 40° and turned like
 * a steering wheel by `turnDegrees` (clockwise, seen from the front, is positive).
 */
export async function tiltPhone(page: Page, turnDegrees: number): Promise<void> {
  await page.evaluate((turn) => {
    const g = 9.81;
    const back = (40 * Math.PI) / 180;
    const angle = (turn * Math.PI) / 180;
    // Turning the phone clockwise swings gravity anticlockwise across its screen.
    const inPlane = g * Math.cos(back);
    const accelerationIncludingGravity = { x: inPlane * Math.cos(angle), y: inPlane * Math.sin(angle), z: g * Math.sin(back) };
    window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity }));
  }, turnDegrees);
}

/** Opens the settings from the pause menu while driving. */
export async function openSettingsWhileDriving(page: Page): Promise<void> {
  await page.locator('.pause-button').click();
  await page.locator('[data-action="pause-settings"]').click();
  await expect(page.locator('.settings')).toBeVisible();
}

/** Closes the settings, then the pause menu: back on the road. */
export async function closeSettingsAndResume(page: Page): Promise<void> {
  await page.locator('[data-action="close-settings"]').click();
  await expect(page.locator('.settings')).toBeHidden();
  await page.locator('[data-action="resume"]').click();
  await expect(page.locator('.pause-menu')).toBeHidden();
}
