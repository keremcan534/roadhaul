// The trailer's shots and its cut. SHOTS are the scenes taken in the game (shoot.mjs): where, when, which truck, how it
// drives and how the camera moves; the places and moves were scouted in the game for their light and what stands
// behind them. The cut list (cutList.mjs) lays them on the beat, with the words (captions.mjs) over them. plan() turns
// both into what the page that draws the cut needs (compose.js).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { captionsIn } from './captions.mjs';
import { CUT, WORDS } from './cutList.mjs';
import { fixed, rig } from './cameras.mjs';
import { alongPath, curve, fleetRoute, lanePath, placeAt, spawnAt } from './geo.mjs';
import { FPS } from './shoot.mjs';
import { BEAT, DURATION, HITS, beat } from './timeline.mjs';

const AUTUMN = 'weather=clear&date=2026-09-20&season=autumn';

/** Copperdale's depot: from the main street's westbound lane into the bay (150, -2516), stopping in it. */
const COPPERDALE_BAY = curve([
  [400, -2502.5],
  [300, -2502.5],
  [230, -2502.5],
  [200, -2507],
  [178, -2514],
  [160, -2516],
  [150, -2516],
  [120, -2516],
]);
const COPPERDALE_STOP = alongPath(COPPERDALE_BAY, 150, -2516);
const COPPERDALE_DRIVE = { path: COPPERDALE_BAY, kmh: 22, options: { stopAt: COPPERDALE_STOP, decel: 1.6 } };
const COPPERDALE_STREET = { x: 400, z: -2502.5, headingRadians: -Math.PI / 2 };

/** The fleet: `count` drivers on Havenport-Ironford contracts, `gap` metres apart along the route from `from`. */
function convoy(count, from, gap) {
  const length = fleetRoute('city_a', 'city_b').length;
  const duration = 60 + length / 12.5;
  const drivers = ['driver_derya', 'driver_osman', 'driver_elif', 'driver_hakan', 'driver_zeynep', 'driver_murat'];
  return drivers.slice(0, count).map((driverId, index) => ({
    driverId,
    job: {
      originCityId: 'city_a',
      destinationCityId: 'city_b',
      cargoId: 'packaged_food',
      cargoTons: 3,
      distanceMeters: Math.round(length),
      durationSeconds: duration,
      pay: 1500,
      driverShare: 300,
      fuelCost: 200,
      incident: false,
      elapsedSeconds: 30 + ((from + index * gap) / length) * (duration - 60),
    },
  }));
}

/** Steps the game `seconds` (at 30 frames a second) in the page. */
const wait = (page, seconds) =>
  page.evaluate((frames) => {
    for (let i = 0; i < frames; i++) window.__trailer.step(1000 / 30);
  }, Math.round(seconds * 30));
/** Steps the game until the truck is down to `speed` m/s (the autopilot slowing for a stop). */
async function slowed(page, speed) {
  for (let i = 0; i < 600 && (await page.evaluate(() => window.__drive.v)) > speed; i++) {
    await wait(page, 1 / 30);
  }
}
/** Opens the company panel on `tab` (its CSS slides in on the browser's clock: given time to). */
async function panel(page, tab) {
  await page.locator(`[data-action="dock-${tab === 'jobs' ? 'jobs' : 'garage'}"]`).dispatchEvent('click');
  if (tab !== 'jobs' && tab !== 'garage') {
    await page.locator(`.hq__tab[data-tab="${tab}"]`).dispatchEvent('click');
  }
  await wait(page, 0.3);
  await page.waitForTimeout(500);
}

/**
 * The shots. A localized shot shows the game's HUD or panels, and is taken in each language. Timings are in video
 * seconds; `speed` below 1 is slow motion.
 */
export const SHOTS = [
  {
    // The cold open: the truck roars past a low eye on the verge of the highway by Oakhurst's oak wood at sunset,
    // front-lit by the low sun, with a blast of the air horn as it comes.
    id: 'open',
    query: `${AUTUMN}&time=18:12&traffic=0&spawn=${spawnAt('highway_a_b', 1650, -1)}`,
    truck: 'rh_h1',
    drive: { path: lanePath('highway_a_b', 1650, 600), kmh: 88 },
    runUp: 22.3,
    coast: true,
    camera: fixed({ ease: 'linear', lookTruck: { lookAhead: 4, lookHeight: 1.9 }, a: { cam: [-252.59, 0.8, -655.57], fov: 28 }, b: { cam: [-252.59, 0.8, -655.57], fov: 33 } }),
    seconds: 4,
    actions: [
      { at: 1.15, key: 'KeyH' },
      { at: 2.1, key: 'KeyH', up: true },
    ],
  },
  {
    // The job board, over the truck parked on Copperdale's main street: "Take the job".
    id: 'jobs',
    localized: true,
    query: `${AUTUMN}&time=16:30&traffic=6`,
    save: { truck: 'rh_h1', at: COPPERDALE_STREET },
    camera: 'game',
    hud: true,
    gps: true,
    ready: (page) => panel(page, 'jobs'),
    seconds: 2,
    blur: 2,
    actions: [{ at: 1.25, run: (page) => page.locator('.job-card [data-action="accept"]').first().click() }],
  },
  {
    // From the driver's seat down Copperdale's main street, with the HUD: a delivery under way, traffic ahead.
    id: 'cabin',
    localized: true,
    query: `${AUTUMN}&time=15:00&traffic=16&spawn=${spawnAt('d_main_street', 10, 1)}`,
    save: { truck: 'rh_h1', mission: { missionId: 'mine_supplies', state: 'delivering' } },
    drive: { path: lanePath('d_main_street', 10, 700), kmh: 34 },
    runUp: 25,
    untilAlong: 150,
    camera: 'cabin',
    hud: true,
    gps: true,
    seconds: 2,
  },
  {
    // Leaving Havenport's quay on the harbour road at midday: a low eye backing away before the truck, the cranes and
    // the coaster behind it.
    id: 'harbour',
    query: `${AUTUMN}&time=11:30&traffic=16&spawn=${spawnAt('a_harbour_road', 60, 1)}`,
    truck: 'rh_h1',
    drive: { path: lanePath('a_harbour_road', 60, 680), kmh: 32 },
    runUp: 20,
    untilAlong: 45,
    coast: true,
    camera: rig(2, { ahead: 16, side: -1.2, height: 1.1, lookAhead: 3, lookHeight: 2.8, fov: 48 }, { ahead: 14.5, side: -2.8, height: 1.6, lookAhead: 3, lookHeight: 2.8, fov: 48 }),
    seconds: 2,
  },
  {
    // Over the Kestrel on the country road's bridge at sunset: a drone ahead and to the left over the river, sliding
    // back alongside.
    id: 'bridge',
    query: `${AUTUMN}&time=18:00&traffic=0&spawn=${spawnAt('rural_a_c', 850, 1)}`,
    truck: 'rh_h1',
    drive: { path: lanePath('rural_a_c', 850, 1700), kmh: 65 },
    runUp: 30,
    untilAlong: 400,
    coast: true,
    camera: rig(2, { ahead: 13, side: -14.5, height: 6.2, lookAhead: 3, lookHeight: 1, fov: 44 }, { ahead: 5, side: -16, height: 5, lookAhead: 3, lookHeight: 1, fov: 44 }, { ease: 'linear' }),
    seconds: 2,
  },
  {
    // Dawn mist on the highway: a drone behind and above, sinking.
    id: 'mist',
    query: `${AUTUMN}&time=07:10&mist=0.9&traffic=0&spawn=${spawnAt('highway_a_b', 900, 1)}`,
    truck: 'rh_h1',
    drive: { path: lanePath('highway_a_b', 900, 2400), kmh: 72 },
    runUp: 16,
    coast: true,
    camera: rig(1.2, { ahead: -24, side: 3, height: 11, lookAhead: 50, lookHeight: 2, fov: 45 }, { ahead: -21, side: 3, height: 9, lookAhead: 50, lookHeight: 2, fov: 45 }, { ease: 'linear' }),
    seconds: 1.2,
  },
  {
    // Copperdale's main street after the rain: a double rainbow over the town, puddles on the road.
    id: 'rainbow',
    query: `weather=clear&date=2026-09-20&time=17:00&wet=0.8&traffic=6&spawn=${spawnAt('d_main_street', 20, 1)}`,
    truck: 'rh_h1',
    drive: { path: lanePath('d_main_street', 20, 700), kmh: 35 },
    runUp: 10,
    camera: rig(1.2, { ahead: -18, side: -1.5, height: 6, lookAhead: 40, lookHeight: 10.5, fov: 64 }, { ahead: -17, side: -1.5, height: 7.2, lookAhead: 40, lookHeight: 11.5, fov: 64 }, { ease: 'linear' }),
    seconds: 1.2,
  },
  {
    // Havenport's high street in a thunderstorm at night, the lamps on the wet road; timed so the storm's first
    // strike lights the street in the middle of the shot.
    id: 'storm',
    query: `weather=rain&date=2026-10-20&time=21:40&traffic=10&spawn=-1702.5,-620,0`,
    truck: 'rh_h1',
    drive: { path: lanePath('a_high_street', 140, 900), kmh: 34 },
    runUp: 16.5,
    camera: rig(1.5, { ahead: 10, side: -3.6, height: 1.1, lookAhead: 2, lookHeight: 2.2, fov: 50 }, { ahead: 9, side: -4.3, height: 1.3, lookAhead: 2, lookHeight: 2.2, fov: 50 }, { ease: 'linear' }),
    seconds: 1.5,
  },
  {
    // Wheatcombe in falling snow at dusk, the windows lit.
    id: 'snow',
    query: `weather=snow&date=2027-01-20&time=17:40&traffic=4&spawn=${spawnAt('wheatcombe_street', 0, 1)}`,
    truck: 'rh_h1',
    drive: { path: lanePath('wheatcombe_street', 0, 228), kmh: 28 },
    runUp: 8,
    camera: rig(1.2, { ahead: 14, side: -3, height: 1.6, lookAhead: 3, lookHeight: 1.9, fov: 46 }, { ahead: 12.8, side: -3.5, height: 1.8, lookAhead: 3, lookHeight: 1.9, fov: 46 }, { ease: 'linear' }),
    seconds: 1.2,
  },
  {
    // A delivery to Copperdale, behind the truck as the game shows it: it rolls to a stop in the green bay, unloads,
    // and "Delivered!" comes up with the pay (and the game's chime).
    id: 'paid',
    localized: true,
    query: `${AUTUMN}&time=16:30&traffic=0`,
    save: { truck: 'rh_h1', at: COPPERDALE_STREET, mission: { missionId: 'mine_supplies', state: 'delivering' } },
    drive: COPPERDALE_DRIVE,
    runUp: 40,
    untilAlong: COPPERDALE_STOP - 18,
    ready: (page) => slowed(page, 1.2),
    camera: 'game',
    hud: true,
    seconds: 5,
    marks: {
      stopped: () => window.__drive.v < 0.05,
      result: () => document.querySelector('.result-dialog')?.checkVisibility() === true,
    },
  },
  {
    // The garage: the truck in paint after paint, on the beat, the camera circling it.
    id: 'paint',
    query: `${AUTUMN}&time=17:20&traffic=0`,
    save: { truck: 'rh_h1', at: COPPERDALE_STREET },
    ready: (page) => panel(page, 'garage'),
    camera: rig(2.2, { ahead: 7, side: -11, height: 2.1, lookAhead: 4.4, lookHeight: 1.7, fov: 40 }, { ahead: 2, side: -11, height: 1.7, lookAhead: 3.6, lookHeight: 1.7, fov: 40 }),
    seconds: 2.2,
    actions: [
      { at: beat(1), click: '.paint-picker__swatch[data-paint-id="ocean_blue"]' },
      { at: beat(2), click: '.paint-picker__swatch[data-paint-id="signal_red"]' },
      { at: beat(3), click: '.paint-picker__swatch[data-paint-id="lagoon_teal"]' },
    ],
  },
  {
    // The blue reefer, the second of the three trucks, past the wind farm at golden hour: a long lens beside it.
    id: 'reefer',
    query: `${AUTUMN}&time=17:50&traffic=0`,
    save: { truck: 'rh_h2', at: placeAt('highway_a_b', 1000, 1) },
    drive: { path: lanePath('highway_a_b', 1000, 2400), kmh: 82 },
    runUp: 40,
    untilAlong: 760,
    coast: true,
    camera: rig(1.5, { ahead: 2, side: -20, height: 1.6, lookAhead: 3, lookHeight: 4.5, fov: 28 }, { ahead: 5, side: -20, height: 1.9, lookAhead: 4, lookHeight: 4.5, fov: 28 }, { ease: 'linear' }),
    seconds: 1.5,
  },
  {
    // The company's lorries out on contracts, overtaking the truck on the highway at golden hour: a drone high on
    // the left, sliding forward.
    id: 'fleet',
    query: `${AUTUMN}&time=17:30&traffic=10`,
    save: { truck: 'rh_h1', at: placeAt('highway_a_b', 900, 1), fleet: convoy(6, 1100, 40) },
    drive: { path: lanePath('highway_a_b', 900, 2900), kmh: 50 },
    runUp: 38,
    camera: rig(2.2, { ahead: -30, side: -18, height: 14, lookAhead: 30, lookSide: 2, lookHeight: -2, fov: 52 }, { ahead: -20, side: -20, height: 15, lookAhead: 40, lookSide: 2, lookHeight: -2, fov: 52 }),
    seconds: 2.2,
  },
  {
    // The rivals: the league of the region's haulage companies.
    id: 'rivals',
    localized: true,
    query: `${AUTUMN}&time=17:20&traffic=0`,
    save: { truck: 'rh_h3', at: COPPERDALE_STREET },
    camera: 'game',
    hud: true,
    ready: (page) => panel(page, 'rivals'),
    seconds: 2,
    blur: 1,
  },
  {
    // The finale: the red flatbed with its bricks, westbound past Oakhurst's oaks at sunset, in slow motion; a low
    // eye at its front quarter, rising.
    id: 'hero',
    query: `${AUTUMN}&time=18:12&traffic=0`,
    save: { truck: 'rh_h3', at: placeAt('highway_a_b', 1650, -1), mission: { missionId: 'quarry_stone', state: 'delivering' } },
    drive: { path: lanePath('highway_a_b', 1650, 600), kmh: 75 },
    runUp: 30,
    coastLead: 2,
    camera: rig(2.1, { ahead: 21, side: 3.4, height: 0.7, lookAhead: 7, lookHeight: 2.0, fov: 34 }, { ahead: 19, side: 4.4, height: 3.6, lookAhead: 7, lookHeight: 1.7, fov: 34 }),
    seconds: 2.1,
    speed: 0.5,
  },
  {
    // The brand: the truck drives on into the setting sun, the drone rising and falling back.
    id: 'sunset',
    query: `${AUTUMN}&time=18:20&traffic=0&spawn=${spawnAt('highway_a_b', 2250, -1)}`,
    truck: 'rh_h1',
    drive: { path: lanePath('highway_a_b', 2250, 600), kmh: 80 },
    runUp: 22,
    coastLead: 2,
    camera: rig(4, { ahead: -11, side: 0, height: 2.4, lookAhead: 30, lookHeight: 3, fov: 48 }, { ahead: -42, side: 0, height: 17, lookAhead: 110, lookHeight: 4, fov: 48 }),
    seconds: 4,
  },
];

/** A shot's folder: its id, and the language for a localized one. */
export const shotFolder = (id, lang) => (lang === null ? id : `${id}-${lang}`);

/** The cut in `lang`, in seconds, as compose.js draws it, from the shots taken into `shotsDir`. */
export function plan(lang, shotsDir) {
  const clips = CUT.map((clip, index) => {
    const shot = SHOTS.find((candidate) => candidate.id === clip.shot);
    const folder = shotFolder(shot.id, shot.localized ? lang : null);
    const record = join(shotsDir, folder, 'shot.json');
    if (!existsSync(record)) throw new Error(`Shot ${folder} has not been taken.`);
    const taken = JSON.parse(readFileSync(record, 'utf8'));
    let at = clip.at ?? 0;
    if (clip.mark !== undefined) {
      const frame = taken.marks[clip.mark];
      if (frame === undefined) throw new Error(`Shot ${folder} never came to its mark "${clip.mark}".`);
      at = Math.max(0, frame / FPS - beat(clip.before));
    }
    const next = CUT[index + 1];
    return {
      shot: folder,
      from: beat(clip.from),
      to: next === undefined ? DURATION : beat(next.from),
      at,
      speed: 1,
      frames: taken.frames,
      in: clip.in ?? 'cut',
      zoom: clip.zoom,
      punch: clip.punch === true,
      sound: clip.sound ?? 1,
      tail: clip.tail,
    };
  });
  const words = captionsIn(lang);
  return {
    fps: FPS,
    duration: DURATION,
    beat: BEAT,
    clips,
    captions: WORDS.map((word) => ({ lines: words[word.key], from: beat(word.from), to: beat(word.to), place: word.place })),
    finale: { words: words.finale, at: HITS.finale.map(beat), to: beat(HITS.brand) - 0.05 },
    brand: { at: beat(HITS.brand) },
    tagline: words.tagline,
  };
}
