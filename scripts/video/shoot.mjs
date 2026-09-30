// The store video's footage, shot in the game itself (the production build in headless Chromium): short clips of
// the truck on the road, frame by frame on the video's clock, and stills of the game's panels at a phone's size.
// scripts/storeVideo.mjs cuts them together.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Frames per second of the clips, and of the video. */
export const FPS = 30;

const HOOK = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'captureHook.js'), 'utf8');
/** Every clip and still: English, the high preset. */
const COMMON_QUERY = 'lang=en&quality=high';
/** The company in the stills. */
const COMPANY = 'Northstar Haulage';
/** The size the game is booted and run up at between shots: frames drawn in software are cheap there. */
const SMALL = { width: 320, height: 180 };
const VIDEO = { width: 1920, height: 1080 };
/** A phone on its side (CSS pixels), drawn at twice that, for the stills. */
const PHONE = { width: 915, height: 412 };

/**
 * The spawn (`?spawn`) that puts the truck in the right-hand lane of a road through (x, z), heading along it
 * (degrees, 0 along +z, 90 along +x): `offset` metres right of the centreline (src/domain/world/lanes.ts).
 */
function inLane(x, z, headingDegrees, offset) {
  const heading = (headingDegrees * Math.PI) / 180;
  // Right of the direction of travel (sin h, cos h), north being -z.
  const rightX = -Math.cos(heading);
  const rightZ = Math.sin(heading);
  const round = (value) => Math.round(value * 10) / 10;
  return `${round(x + rightX * offset)},${round(z + rightZ * offset)},${headingDegrees}`;
}

/**
 * The clips. Each boots the game with a new company at `spawn`, drives on (throttle held) for `runUp` seconds, then
 * records `seconds` of video at `speed` (game seconds per second of video: 0.5 is slow motion).
 *
 * `turn` swings the camera round the truck as a player's drag does: the pointer's distance from where the drag
 * began, in fractions of the screen's width and height, at the clip's start and at its end (eased between). About
 * 0.55 of the width is a quarter turn, as far as the camera turns. `camera: 'cabin'` rides in the cab; `hud` keeps the game's HUD on screen.
 */
export const CLIPS = [
  {
    id: 'hero',
    // The country road north of Havenport on an autumn evening, the sun setting beyond the fields; the camera swings
    // from behind the truck round to its side, the side without the power line (its poles would cross the lens).
    query: 'weather=clear&date=2026-09-20&time=18:15&traffic=6',
    spawn: inLane(-1699, -850, 178.9, 2),
    runUp: 10,
    seconds: 4.4,
    turn: [
      [-0.12, -0.02],
      [-0.6, -0.04],
    ],
  },
  {
    id: 'cabin',
    // The highway east of the rest area on a summer morning, from the driver's seat, with the HUD.
    query: 'weather=clear&date=2026-06-20&time=10:40&traffic=16',
    spawn: inLane(300, -641, 84, 5.25),
    runUp: 8,
    seconds: 3,
    camera: 'cabin',
    hud: true,
  },
  {
    id: 'night',
    // Havenport's high street on a rainy autumn night: the lamps on the wet road.
    query: 'weather=rain&date=2026-10-20&time=21:40&traffic=10',
    spawn: inLane(-1700, -720, 0, 2.5),
    runUp: 8,
    seconds: 1.5,
    turn: [
      [0.07, 0.02],
      [0.11, 0.02],
    ],
  },
  {
    id: 'snow',
    // Amberfield's village street in the snow.
    query: 'weather=snow&date=2027-01-20&time=11:00&traffic=6',
    spawn: inLane(-50, 1500, 90, 2.25),
    runUp: 8,
    seconds: 1.5,
    turn: [
      [0.66, -0.02],
      [0.71, -0.02],
    ],
  },
  {
    id: 'mist',
    // The highway at dawn in a summer mist, toward the rising sun.
    query: 'weather=clear&date=2026-06-20&time=07:30&mist=0.8&traffic=6',
    spawn: inLane(-300, -640, 99.9, 5.25),
    runUp: 8,
    seconds: 1.5,
  },
  {
    id: 'rainbow',
    // Copperdale's main street after the rain, a rainbow opposite the low sun.
    query: 'weather=clear&date=2026-09-20&time=17:00&wet=0.8&traffic=6',
    spawn: inLane(-200, -2500, 90, 2.5),
    runUp: 8,
    seconds: 1.5,
  },
  {
    id: 'sunset',
    // Havenport's harbour road at sunset, toward the sea, in slow motion.
    query: 'weather=clear&date=2026-09-20&time=18:22&traffic=4',
    spawn: inLane(-1480, -250, 270, 2.5),
    runUp: 8,
    seconds: 4.4,
    speed: 0.5,
    turn: [
      [0.15, 0.02],
      [0.08, 0],
    ],
  },
];

const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const frameName = (index) => `${String(index + 1).padStart(4, '0')}.jpg`;

/** Runs one frame of the game `ms` after the last. */
const step = (page, ms) => page.evaluate((frameMs) => window.__video.step(frameMs), ms);

/** Opens the game with the capture hook at a small size, founds a company and holds the frames. */
async function openGame(browser, baseUrl, query, viewport = SMALL, deviceScaleFactor = 1) {
  const page = await browser.newPage({ viewport, deviceScaleFactor });
  page.setDefaultTimeout(300_000);
  await page.addInitScript({ content: HOOK });
  await page.goto(`${baseUrl}?${COMMON_QUERY}&${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.gameState === 'mainMenu');
  return page;
}

async function foundCompany(page, name) {
  await page.locator('[data-action="new-company"]').click();
  await page.locator('.new-company__input').fill(name);
  await page.locator('[data-action="start-company"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.gameState === 'driving');
  await page.evaluate(() => window.__video.hold());
  const skip = page.locator('[data-action="skip-tutorial"]');
  await step(page, 1000 / FPS);
  if (await skip.isVisible()) {
    await skip.click();
  }
}

/** Shoots `clip` into `<dir>/<id>/0001.jpg…`, unless the folder already holds this very clip. */
export async function shootClip(browser, baseUrl, clip, dir) {
  const folder = join(dir, clip.id);
  const record = join(folder, 'clip.json');
  const spec = JSON.stringify(clip);
  if (existsSync(record) && readFileSync(record, 'utf8') === spec) {
    return false;
  }
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const page = await openGame(browser, baseUrl, `${clip.query}&spawn=${clip.spawn}`);
  try {
    await foundCompany(page, 'RoadHaul');
    if (clip.camera === 'cabin') {
      await page.keyboard.press('KeyC');
    }
    await page.evaluate((hud) => {
      // The game alone, or the HUD without the debug and tutorial notes.
      for (const element of document.body.children) {
        if (element.id !== 'game-canvas' && (!hud || element.matches('.perf-overlay, .tutorial-hint'))) {
          element.style.visibility = 'hidden';
        }
      }
    }, clip.hud === true);
    // Run up at the small size: a quarter second a frame, which the game simulates as a twelfth (its catch-up cap)
    // and its dynamic resolution takes for a hitch, not a slow device.
    await page.keyboard.down('ArrowUp');
    for (let frame = 0; frame < clip.runUp * 12; frame++) {
      await step(page, 250);
    }
    await page.setViewportSize(VIDEO);
    // The drag starts near the side it moves away from, so the pointer stays on the screen.
    const origin = { x: VIDEO.width * ((clip.turn?.[1][0] ?? 0) < 0 ? 0.9 : 0.1), y: VIDEO.height * 0.5 };
    const pointer = (p) => {
      const [[x0, y0], [x1, y1]] = clip.turn;
      const eased = easeInOut(p);
      return {
        x: origin.x + (x0 + (x1 - x0) * eased) * VIDEO.width,
        y: origin.y + (y0 + (y1 - y0) * eased) * VIDEO.height,
      };
    };
    if (clip.turn !== undefined) {
      await page.mouse.move(origin.x, origin.y);
      await page.mouse.down();
      const start = pointer(0);
      await page.mouse.move(start.x, start.y, { steps: 6 });
    }
    const frameMs = (1000 / FPS) * (clip.speed ?? 1);
    // A few frames to settle at the full size.
    for (let frame = 0; frame < 4; frame++) {
      await step(page, frameMs);
    }
    const frames = Math.round(clip.seconds * FPS);
    for (let frame = 0; frame < frames; frame++) {
      if (clip.turn !== undefined) {
        const at = pointer(frame / (frames - 1));
        await page.mouse.move(at.x, at.y);
      }
      await step(page, frameMs);
      writeFileSync(join(folder, frameName(frame)), await page.screenshot({ type: 'jpeg', quality: 92 }));
    }
    writeFileSync(record, spec);
    return true;
  } finally {
    await page.close();
  }
}

/** The stills: the game's panels on a phone on its side, drawn at twice its size. */
export const STILLS = [
  'menu',
  'jobs',
  'result',
  'truck',
  'fleet',
  'company',
  'rivals',
  'events',
  'garage',
  'paint-1',
  'paint-2',
  'paint-3',
  'painted',
  'upgraded',
  'map',
];

/**
 * Plays the game's loop at a phone's size and takes each of STILLS into `<dir>/<name>.png`: the main menu, the job
 * board, a delivery's result (the debug key T parks the truck in the bays), the company panel's pages, paints tried
 * on the truck, one bought and an upgrade bought in the garage, and the map. Returns (and keeps in `<dir>/stills.json`) what the video draws with them: the brand's drawings and the
 * dock's icons from the game's own page, where the fingers tap (the job board's first "Take the job", the paints'
 * swatches, "Paint it", the upgrade's button: shares of the screen) and the delivery's pay.
 */
export async function shootStills(browser, baseUrl, dir) {
  const record = join(dir, 'stills.json');
  mkdirSync(dir, { recursive: true });
  const page = await openGame(browser, baseUrl, 'debug&weather=clear&date=2026-09-20&time=17:40&traffic=8', PHONE, 2);
  try {
    const html = page.locator('html');
    const settle = async (frames = 8, ms = 1000 / FPS) => {
      for (let frame = 0; frame < frames; frame++) {
        await step(page, ms);
      }
      // Panels slide and fade in on the browser's clock, not the game's.
      await page.waitForTimeout(600);
    };
    const snap = async (name) => writeFileSync(join(dir, `${name}.png`), await page.screenshot());
    await page.addStyleTag({ content: '.perf-overlay{display:none!important}' });
    const brandSvg = await page.evaluate(() => ({
      mark: document.querySelector('.main-menu__mark')?.outerHTML ?? '',
      word: document.querySelector('.main-menu__wordmark')?.outerHTML.replace('main-menu__wordmark', 'wordmark') ?? '',
    }));
    await page.evaluate(() => window.__video.hold());
    await settle(20);
    await snap('menu');
    await page.locator('[data-action="new-company"]').click();
    await page.locator('.new-company__input').fill(COMPANY);
    await page.locator('[data-action="start-company"]').click();
    while ((await html.getAttribute('data-game-state')) !== 'driving') {
      await settle(2);
    }
    await settle(4);
    if (await page.locator('[data-action="skip-tutorial"]').isVisible()) {
      await page.locator('[data-action="skip-tutorial"]').click();
    }
    const icons = await page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll('.hud-dock__button')].map((button) => [
          button.dataset.tab,
          button.querySelector('svg')?.outerHTML ?? '',
        ]),
      ),
    );
    await page.locator('[data-action="dock-jobs"]').click();
    await settle();
    await snap('jobs');
    // Where the first card's "Take the job" is, as a share of the screen: the video's finger taps it.
    const accept = await page.locator('.job-card [data-action="accept"]').first().boundingBox();
    const tap = { x: (accept.x + accept.width / 2) / PHONE.width, y: (accept.y + accept.height / 2) / PHONE.height };
    await page.locator('.job-card[data-mission-id="first_package"] [data-action="accept"]').click();
    await settle();
    // Parked in the pickup bay; loading takes three seconds standing.
    await page.keyboard.press('KeyT');
    while ((await html.getAttribute('data-mission-state')) !== 'loaded') {
      await settle(6, 250);
    }
    await page.keyboard.down('ArrowUp');
    while ((await html.getAttribute('data-mission-state')) !== 'delivering') {
      await settle(2, 250);
    }
    await page.keyboard.up('ArrowUp');
    await page.keyboard.press('KeyT');
    while (!(await page.locator('.result-dialog').isVisible())) {
      await settle(6, 250);
    }
    await settle();
    await snap('result');
    const pay = Number((await page.locator('.result-dialog__line.is-total dd').textContent()).replace(/\D/g, ''));
    await page.locator('[data-action="result-jobs"]').click();
    await settle();
    for (const tab of ['truck', 'fleet', 'company', 'rivals', 'events', 'garage']) {
      await page.locator(`.hq__tab[data-tab="${tab}"]`).click();
      await settle();
      await snap(tab);
    }
    // The garage: three paints tried on the truck (red, green, then blue), the blue bought, then the engine upgraded.
    const centre = (box) => ({ x: (box.x + box.width / 2) / PHONE.width, y: (box.y + box.height / 2) / PHONE.height });
    const paints = [];
    for (const [index, nth] of [0, 2, 1].entries()) {
      const swatch = page.locator('.paint-picker__swatch:not(.is-locked):not(.is-current)').nth(nth);
      paints.push(centre(await swatch.boundingBox()));
      await swatch.click();
      await settle(12);
      await snap(`paint-${index + 1}`);
    }
    const apply = page.locator('[data-action="paint-truck"]');
    const paint = centre(await apply.boundingBox());
    await apply.click();
    await settle();
    await snap('painted');
    const buy = page.locator('.upgrade-card__action').first();
    const upgrade = centre(await buy.boundingBox());
    await buy.click();
    await settle();
    await snap('upgraded');
    await page.locator('[data-action="close-hq"]').click();
    await settle();
    await page.keyboard.press('KeyM');
    // The map and its key, without its title, its buttons and the garage's notes: the video frames the region.
    await page.addStyleTag({ content: '.world-map__bar,.world-map__tools,.toasts{visibility:hidden!important}' });
    await settle();
    await snap('map');
    const found = { brand: brandSvg, icons, tap, pay, paints, paint, upgrade };
    writeFileSync(record, JSON.stringify(found));
    return found;
  } finally {
    await page.close();
  }
}
