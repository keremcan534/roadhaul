// The trailer's footage, shot in the game itself: the production build in headless Google Chrome, drawn on the
// machine's GPU (Playwright's `chrome` channel), frame by frame on the video's clock (hook.js). Each shot boots the
// game with a company (a new one, or a saved one: the truck, a contract under way, drivers out), drives it on with the
// autopilot (drive.js), and records frames of 3840 × 2160 at 30 per second, each the average of sub-frames (motion
// blur), with the game's own sound under them.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wavFile } from './audio.mjs';
import { handlingOf, vehicles } from './geo.mjs';

export const FPS = 30;
/** The video's size, in pixels. */
export const WIDTH = 3840;
export const HEIGHT = 2160;
/**
 * The page's size in CSS pixels: a phone held on its side, as wide as the video's shape allows. The UI is drawn at
 * that size, and the 3D at the video's full resolution.
 */
export const PAGE = { width: 800, height: 450 };
/** Where the game is booted and run up before a shot: frames drawn there are cheap. */
const SMALL = { width: 320, height: 180 };

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = readFileSync(join(HERE, 'hook.js'), 'utf8');
const DRIVE = readFileSync(join(HERE, 'drive.js'), 'utf8');

/** Runs one frame of the game `ms` after the last (the autopilot deciding first). */
const step = (page, ms) => page.evaluate((frameMs) => window.__trailer.step(frameMs), ms);

/**
 * A saved company (the game's save, version 11), saved at midnight of `date` (the day ?date starts the calendar on,
 * so the fleet has had no time away to finish its contracts in): `truck` driven, parked `at` ({x, z, headingRadians},
 * or null for the map's start or ?spawn), painted `paint`; `mission` ({missionId, state}) under way; `fleet`: drivers
 * out on jobs. The company is "RoadHaul"'s own: its trucks carry the brand.
 */
export function savedGame({ truck = 'rh_h1', at = null, paint = null, upgrades = {}, mission = null, fleet = [], date = '2026-09-20' }) {
  const savedAtMs = Date.parse(`${date}T00:00:00Z`);
  const fuel = (id) => vehicles[id].fuelCapacityLiters;
  const garage = [{ instanceId: 'truck_001', definitionId: truck, fuelLiters: fuel(truck), damage: 0, upgrades, paintId: paint }];
  const drivers = fleet.map((driver, index) => {
    const instanceId = `truck_${String(index + 2).padStart(3, '0')}`;
    const definitionId = driver.truck ?? 'rh_h1';
    garage.push({ instanceId, definitionId, fuelLiters: fuel(definitionId), damage: 0, upgrades: {}, paintId: null });
    return {
      driverId: driver.driverId,
      truckInstanceId: instanceId,
      cityId: driver.job.originCityId,
      job: driver.job,
      repairSecondsLeft: 0,
      jobsCompleted: 3,
      creditsEarned: 5000,
    };
  });
  return {
    version: 11,
    createdAtMs: savedAtMs - 86_400_000,
    updatedAtMs: savedAtMs,
    profile: { companyName: 'RoadHaul' },
    company: { level: 5, xp: 12_000, reputation: 80 },
    economy: { credits: 184_500 },
    garage: { activeVehicleInstanceId: 'truck_001', vehicles: garage },
    world: { mapId: 'north_valley', truck: at },
    missions: {
      active:
        mission === null
          ? null
          : { ...mission, handlingSeconds: 0, deliverySeconds: 5, cargoDamage: 0, failureReason: null, contract: null },
    },
    stats: { deliveriesCompleted: 140, deliveriesFailed: 2, creditsEarned: 400_000, distanceDrivenMeters: 900_000 },
    events: { runs: [] },
    tutorial: { step: 'done' },
    fleet: { drivers, jobsPlanned: drivers.length },
    rivals: {
      companies: [],
      standing: [],
      campaignCooldowns: [],
      tender: null,
      race: null,
      nextTenderSeconds: null,
      tendersPosted: 0,
      jobsPlanned: 0,
    },
    facilities: { levels: {} },
  };
}

/**
 * Opens the game (`query`, in `lang`) with the hooks at a small size and gets it on the road: a new company, or
 * `save` continued; the tutorial skipped, frames held. The game's sound may run `soundSeconds` from then on.
 */
export async function openGame(browser, baseUrl, { query, lang = 'en', save = null, soundSeconds = 60, scale = 1 }) {
  const page = await browser.newPage({ viewport: SMALL, deviceScaleFactor: scale });
  page.setDefaultTimeout(300_000);
  const problems = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.problems = problems;
  await page.addInitScript({ content: HOOK });
  await page.addInitScript({ content: DRIVE });
  if (save !== null) {
    await page.addInitScript((data) => localStorage.setItem('roadhaul.save', data), JSON.stringify(save));
  }
  await page.goto(`${baseUrl}?quality=high&lang=${lang}&${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.gameState === 'mainMenu');
  await page.evaluate((seconds) => window.__trailer.soundLength(seconds), soundSeconds);
  if (save !== null) {
    await page.locator('[data-action="continue-game"]').click({ timeout: 15_000 });
  } else {
    await page.locator('[data-action="new-company"]').click();
    await page.locator('.new-company__input').fill('RoadHaul');
    await page.locator('[data-action="start-company"]').click();
  }
  await page.waitForFunction(() => document.documentElement.dataset.gameState === 'driving');
  await page.evaluate(() => window.__trailer.hold());
  // The frame asked for before hold() comes from the display, and late (the world is being built): until the game
  // has asked again, held, step() runs nothing.
  for (let attempt = 0; (await step(page, 0)) === 0; attempt++) {
    if (attempt > 1000) throw new Error('The game never asked for a held frame.');
    await page.waitForTimeout(20);
  }
  await step(page, 1000 / FPS);
  const skip = page.locator('[data-action="skip-tutorial"]');
  if (await skip.isVisible()) {
    await skip.dispatchEvent('click');
  }
  await page.addStyleTag({ content: '.perf-overlay,.toasts,.tutorial-hint{visibility:hidden!important}' });
  return page;
}

/** Shows only the game's 3D (and the trailer's frame over it), or the HUD too. */
async function showHud(page, hud) {
  await page.evaluate((on) => {
    for (const element of document.body.children) {
      if (element.id !== 'game-canvas' && element.id !== 'trailer-frame' && element.tagName !== 'SCRIPT') {
        element.style.visibility = on ? '' : 'hidden';
      }
    }
  }, hud);
}

/**
 * What the shot does as it runs: { at: seconds into the shot, and one of key (held from `at`; with up: true, let
 * go; with tap: true, pressed once), click (a selector, clicked in the page, so it works on hidden UI too), or
 * run(page) }.
 */
async function act(page, actions, t, done) {
  for (const [index, action] of actions.entries()) {
    if (done.has(index) || action.at > t + 1e-6) continue;
    done.add(index);
    if (action.click !== undefined) {
      await page.locator(action.click).first().dispatchEvent('click');
    } else if (action.run !== undefined) {
      await action.run(page);
    } else if (action.up) {
      await page.keyboard.up(action.key);
    } else if (action.tap) {
      await page.keyboard.press(action.key);
    } else {
      await page.keyboard.down(action.key);
    }
  }
}

/** Runs `seconds` of game time at the small size, a twelfth of a second a frame (the game's catch-up cap). */
async function runUp(page, seconds, untilAlong = null) {
  for (let frame = 0; frame < Math.round(seconds * 12); frame++) {
    if (untilAlong !== null && (await page.evaluate(() => window.__drive.progress())) >= untilAlong) break;
    await step(page, 1000 / 12);
  }
}

/**
 * Shoots `shot` into `<dir>/<id>/0001.jpg…`, with `sound.wav` (the game's sound over the shot) and `shot.json` (the
 * shot as taken, and the frames its marks came true on), unless the folder already holds this very shot. A shot:
 *   query (the game's URL, without quality and lang); save (savedGame's options) or a new company; truck;
 *   drive ({ path, kmh, options }: the autopilot), runUp (game seconds before the shot), untilAlong (or until the
 *   autopilot has come this far), coastLead (seconds before the shot it stops pressing the throttle), coast (no
 *   throttle in the shot); setup(page) (before the run-up), ready(page) (after it, at the full size); seconds (of
 *   video), speed (game seconds a video second: 0.5 is slow motion); camera ({source, params} from cameras.mjs, or
 *   'game': the game's own, 'cabin' its cab view); hud (the game's HUD on screen); gps (its route on the road);
 *   actions (act()'s, at video seconds); marks ({ name: a function the page runs each frame }: the first frame it
 *   returns true on); blur (sub-frames a frame; 1 is none), shutter (the share of a frame they span); page (the
 *   page's size in CSS pixels, if not PAGE).
 */
export async function shootShot(browser, baseUrl, shot, dir, { lang = 'en' } = {}) {
  const folder = join(dir, shot.id);
  const record = join(folder, 'shot.json');
  const spec = JSON.stringify({ ...shot, lang }, (key, value) => (typeof value === 'function' ? value.toString() : value));
  if (existsSync(record) && JSON.parse(readFileSync(record, 'utf8')).spec === spec) {
    return false;
  }
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const speed = shot.speed ?? 1;
  const size = shot.page ?? PAGE;
  const ratio = WIDTH / size.width;
  const page = await openGame(browser, baseUrl, {
    scale: ratio,
    query: shot.query,
    lang,
    save: shot.save === undefined ? null : savedGame(shot.save),
    soundSeconds: (shot.runUp ?? 0) + shot.seconds * speed + 30,
  });
  try {
    await page.evaluate(() => window.__trailer.listen());
    if (shot.gps !== true) {
      // A contract's route on the road, out of the picture.
      await page.evaluate(() => {
        const line = window.__trailer.state.scene.getObjectByName('gps-route');
        if (line) line.layers.set(31);
      });
    }
    if (shot.camera === 'cabin') {
      await page.keyboard.press('KeyC');
    }
    await showHud(page, shot.hud === true);
    await shot.setup?.(page);
    if (shot.drive !== undefined) {
      await page.evaluate(
        ({ path, kmh, handling, options }) => window.__drive.set(path, kmh, handling, options),
        { ...shot.drive, handling: handlingOf(shot.truck ?? shot.save?.truck ?? 'rh_h1'), options: shot.drive.options ?? {} },
      );
    }
    const lead = shot.coastLead ?? 0;
    await runUp(page, (shot.runUp ?? 0) - lead, shot.untilAlong ?? null);
    if (lead > 0 || shot.coast) {
      await page.evaluate(() => (window.__drive.coast = true));
      await runUp(page, lead);
    }
    await page.evaluate((r) => window.__trailer.setPixelRatio(r), ratio);
    await page.setViewportSize(size);
    await page.waitForFunction((width) => document.querySelector('#game-canvas').width === width, WIDTH);
    await shot.ready?.(page);
    const frameMs = (1000 / FPS) * speed;
    const settle = 6;
    if (typeof shot.camera === 'object') {
      const params = { ...shot.camera.params, seconds: shot.seconds * speed };
      await page.evaluate(({ source, params, delay }) => window.__trailer.setShot(source, params, delay), {
        source: shot.camera.source,
        params,
        delay: settle * frameMs,
      });
    }
    // A few frames to settle at the full size and round the new eye (the plants by the road are gathered there).
    for (let frame = 0; frame < settle; frame++) {
      await step(page, frameMs);
    }
    const startHeard = await page.evaluate(() => window.__trailer.heard());
    const blur = shot.blur ?? 4;
    const shutter = shot.shutter ?? 0.5;
    const frames = Math.round(shot.seconds * FPS);
    const done = new Set();
    const marks = {};
    const markSources = Object.entries(shot.marks ?? {}).map(([name, check]) => [name, check.toString()]);
    for (let frame = 0; frame < frames; frame++) {
      await act(page, shot.actions ?? [], frame / FPS, done);
      // The sub-frames span the shutter's share of the frame, ending on the frame's time.
      const sub = (frameMs * shutter) / blur;
      const came = await page.evaluate(
        ({ samples, sub, first, width, height, checks }) => {
          const trailer = window.__trailer;
          trailer.accum.begin();
          for (let i = 0; i < samples; i++) {
            if (trailer.drawStep(i === 0 ? first : sub)) {
              trailer.accum.add();
            }
          }
          trailer.accum.finish(width, height, true);
          return checks.filter(([, source]) => new Function(`return (${source})();`)()).map(([name]) => name);
        },
        { samples: blur, sub, first: frameMs - sub * (blur - 1), width: WIDTH, height: HEIGHT, checks: markSources.filter(([name]) => !(name in marks)) },
      );
      for (const name of came) marks[name] = frame;
      writeFileSync(join(folder, `${String(frame + 1).padStart(4, '0')}.jpg`), await page.screenshot({ type: 'jpeg', quality: 98 }));
    }
    await page.evaluate(() => window.__drive.off());
    const pcm = await page.evaluate(({ from, seconds }) => window.__trailer.sound(from, seconds), {
      from: startHeard,
      seconds: shot.seconds * speed,
    });
    if (pcm !== null) {
      writeFileSync(join(folder, 'sound.wav'), wavFile(Buffer.from(pcm, 'base64')));
    }
    if (page.problems.length > 0) {
      throw new Error(`The game failed in shot ${shot.id}: ${page.problems.join('; ')}`);
    }
    writeFileSync(record, JSON.stringify({ spec, frames, marks }));
    return true;
  } finally {
    await page.close();
  }
}
