// The mobile performance run: the production build as phones run it, scene by scene, on three phones.
//
//   npm run build && node scripts/perfRun.mjs [low,mid,high] [menu,highway,cityNight,rain,panel,map]
//                                            [--counters] [--trace] [--heap] [--cpu-profile]
//
// Headless Chromium has no GPU, and the game draws a plainer world when it finds itself drawn in software. So the
// page is told a phone's GPU name, cores and memory (scripts/perf/instrument.js) and builds exactly what that phone
// gets at its preset; the main thread is slowed to the phone's speed (CPU throttling: 6× for a low-end phone, 4× for
// a mid-range one, 2× for a flagship); and the GPU's own drawing is left out, since software drawing would take
// seconds a frame: every draw's CPU work (three.js's culling, state and uniforms, the uploads) still happens. What
// it measures holds for a phone with a GPU fast enough: how long the game keeps the main thread each frame (the
// frame rate the CPU allows), its long tasks, the draw calls and triangles in view, the boot to the main menu, and
// the heap. What only a phone can tell, the GPU's fill and shaders, heat and battery, is step 29's
// (docs/RELEASE.md). The numbers are estimates: a phone is not a throttled desktop.
//
// --counters adds the draw and uniform calls of a frame and what the GPU holds (they cost ~15% of the frame time);
// --trace, --heap and --cpu-profile save a Chrome trace, a sampled heap profile or a CPU profile of each scene's
// window into perf-results/, to open in Chrome DevTools (Performance, Memory). The summary is perf-results/run.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { join } from 'node:path';
import { chromium, devices } from '@playwright/test';
import { ROOT } from './storeKit.mjs';

const PORT = 4183;
const OUT = join(ROOT, 'perf-results');
const INSTRUMENT = readFileSync(join(ROOT, 'scripts/perf/instrument.js'), 'utf8');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The phones: the preset each gets, how much slower its CPU is, its screen, and what the game is told. */
const PROFILES = {
  low: { quality: 'low', cpu: 6, viewport: { width: 800, height: 360 }, dpr: 2, cores: 4, memory: 3, gpu: 'ANGLE (ARM, Mali-G52 MC2, OpenGL ES 3.2)' },
  mid: { quality: 'medium', cpu: 4, viewport: { width: 915, height: 412 }, dpr: 2.625, cores: 8, memory: 6, gpu: 'ANGLE (Qualcomm, Adreno (TM) 619, OpenGL ES 3.2)' },
  high: { quality: 'high', cpu: 2, viewport: { width: 915, height: 412 }, dpr: 3, cores: 8, memory: 8, gpu: 'ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)' },
};

async function attribute(page, name, value) {
  await page.waitForFunction(([n, v]) => document.documentElement.getAttribute(n) === v, [name, value], { timeout: 240_000 });
}

async function foundCompany(page) {
  await page.locator('[data-action="new-company"]').click();
  await page.locator('.new-company__input').fill('Perf Lojistik');
  await page.locator('[data-action="start-company"]').click();
  await attribute(page, 'data-game-state', 'driving');
}

async function openJobs(page) {
  const button = page.locator('[data-action="dock-jobs"]');
  await ((await button.isVisible()) ? button : page.locator('[data-action="dock-truck"]')).click();
  await attribute(page, 'data-panel', 'open');
}

/** The scenes: the address's extras, how to get there, how long to let it settle, and how long to measure. */
const SCENES = {
  menu: { query: '', settle: 0, seconds: 8, reach: async () => {} },
  highway: {
    query: '&spawn=300,-641,84',
    settle: 8000,
    seconds: 12,
    reach: async (page) => {
      await foundCompany(page);
      await page.keyboard.down('ArrowUp');
      await sleep(4000);
    },
  },
  cityNight: {
    query: '&weather=night',
    settle: 8000,
    seconds: 12,
    reach: async (page) => {
      await foundCompany(page);
      await openJobs(page);
      await page.locator('.job-card[data-mission-id="first_package"] [data-action="accept"]').click();
      await attribute(page, 'data-panel', 'none');
      // Parked in the pickup bay, in the city's yard among its buildings (?debug's T key).
      await page.keyboard.press('KeyT');
      await sleep(3000);
    },
  },
  rain: {
    query: '&weather=rain',
    settle: 8000,
    seconds: 12,
    reach: async (page) => {
      await foundCompany(page);
      await page.keyboard.down('ArrowUp');
      await sleep(4000);
    },
  },
  panel: {
    query: '',
    settle: 2000,
    seconds: 8,
    reach: async (page) => {
      await foundCompany(page);
      await openJobs(page);
    },
  },
  map: {
    query: '',
    settle: 2000,
    seconds: 8,
    reach: async (page) => {
      await foundCompany(page);
      await page.keyboard.press('KeyM');
      await page.locator('.world-map').waitFor({ state: 'visible' });
    },
  },
};

const quantile = (values, q) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] * 10) / 10;
};

async function measure(browser, profileId, sceneId, options) {
  const profile = PROFILES[profileId];
  const scene = SCENES[sceneId];
  const context = await browser.newContext({
    ...devices['Pixel 7 landscape'],
    viewport: profile.viewport,
    screen: profile.viewport,
    deviceScaleFactor: profile.dpr,
  });
  const settings = { gpu: profile.gpu, cores: profile.cores, memory: profile.memory, stubDraws: true, lean: !options.counters, trackGl: options.counters && !options.heap };
  await context.addInitScript(`(${INSTRUMENT})(${JSON.stringify(settings)})`);
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(error.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
  const result = { phone: profileId, scene: sceneId, cpuSlowdown: profile.cpu };
  const name = `${profileId}-${sceneId}`;
  try {
    const started = Date.now();
    // Only the response: the boot, timed below, outlasts the page's load event on a slow phone.
    await page.goto(`http://127.0.0.1:${PORT}/?debug&lang=en&date=2025-12-01&quality=${profile.quality}${scene.query}`, { waitUntil: 'commit' });
    await attribute(page, 'data-boot-state', 'ready');
    result.bootSeconds = Math.round((Date.now() - started) / 100) / 10;
    result.bootLongestTaskMs = Math.round(Math.max(0, ...(await page.evaluate(() => __perf.long.map(([, d]) => d)))));
    result.quality = await page.evaluate(() => document.documentElement.dataset.quality);
    await scene.reach(page);
    await sleep(scene.settle);
    await page.evaluate(() => {
      __perf.frames.length = 0;
      __perf.long.length = 0;
      __perf.linksBefore = __perf.links;
      __perf.drawsBefore = __perf.draws;
      __perf.uniformsBefore = __perf.uniforms;
    });
    if (options.trace) {
      await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8'] });
    }
    if (options.heap) {
      await cdp.send('HeapProfiler.enable');
      await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    }
    if (options.cpuProfile) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
      await cdp.send('Profiler.start');
    }
    const startedAt = Date.now();
    await sleep(scene.seconds * 1000);
    const seconds = (Date.now() - startedAt) / 1000;
    if (options.trace) writeFileSync(join(OUT, `${name}.trace.json`), await browser.stopTracing());
    if (options.heap) writeFileSync(join(OUT, `${name}.heapprofile`), JSON.stringify((await cdp.send('HeapProfiler.stopSampling')).profile));
    if (options.cpuProfile) writeFileSync(join(OUT, `${name}.cpuprofile`), JSON.stringify((await cdp.send('Profiler.stop')).profile));
    const window = await page.evaluate(() => ({
      frames: __perf.frames.slice(),
      long: __perf.long.map(([, d]) => d),
      linked: __perf.links - __perf.linksBefore,
      draws: __perf.draws - __perf.drawsBefore,
      uniforms: __perf.uniforms - __perf.uniformsBefore,
      gpu: __perfSnapshot(),
    }));
    const overlay = (await page.locator('.perf-overlay').textContent()) ?? '';
    const p50 = quantile(window.frames, 0.5);
    result.frameMs = { p50, p95: quantile(window.frames, 0.95), max: quantile(window.frames, 1) };
    result.cpuFps = p50 ? Math.round(1000 / p50) : null;
    result.longTasks = window.long.length;
    result.shadersCompiledInWindow = window.linked;
    result.drawCalls = Number(/(\d+) draws/.exec(overlay)?.[1]);
    result.triangles = Number(/(\d+) tris/.exec(overlay)?.[1]);
    result.heapMb = Math.round((await cdp.send('Runtime.getHeapUsage')).usedSize / 1e5) / 10;
    if (options.counters) {
      const frames = Math.max(1, window.frames.length);
      result.uniformCallsPerFrame = Math.round(window.uniforms / frames);
      const g = window.gpu;
      result.gpuMb = g.textureBytes === undefined ? null : Math.round((g.textureBytes + g.bufferBytes + g.renderbufferBytes) / 1e5) / 10;
    }
    result.seconds = Math.round(seconds * 10) / 10;
  } catch (error) {
    result.error = String(error?.message ?? error).split('\n')[0];
  }
  if (problems.length > 0) result.problems = problems.slice(0, 3);
  await context.close();
  return result;
}

/** Serves dist/ as players get it; ready when the port answers. */
async function serve() {
  const vite = join(ROOT, 'node_modules/vite/bin/vite.js');
  const server = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  for (let attempt = 0; attempt < 60; attempt++) {
    const open = await new Promise((resolve) => {
      const socket = connect(PORT, '127.0.0.1', () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
    });
    if (open) return () => server.kill();
    await sleep(500);
  }
  server.kill();
  throw new Error(`The build's server did not start on port ${PORT}: run \`npm run build\` first.`);
}

const args = process.argv.slice(2);
const lists = args.filter((a) => !a.startsWith('--'));
const phones = (lists[0] ?? 'low,mid,high').split(',');
const scenes = (lists[1] ?? Object.keys(SCENES).join(',')).split(',');
const options = { counters: args.includes('--counters'), trace: args.includes('--trace'), heap: args.includes('--heap'), cpuProfile: args.includes('--cpu-profile') };
mkdirSync(OUT, { recursive: true });
const stop = await serve();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
try {
  for (const phone of phones) {
    for (const scene of scenes) {
      const result = await measure(browser, phone, scene, options);
      results.push(result);
      const f = result.frameMs ?? {};
      console.log(
        `${phone.padEnd(5)} ${scene.padEnd(10)} boot ${String(result.bootSeconds).padStart(5)} s  frame ${f.p50} ms (p95 ${f.p95}, max ${f.max})` +
          `  ≈${result.cpuFps} fps by the CPU  ${result.drawCalls} draws  ${result.triangles} tris  ${result.longTasks} long tasks${result.error ? '  ERROR ' + result.error : ''}`,
      );
      writeFileSync(join(OUT, 'run.json'), JSON.stringify(results, null, 1));
    }
  }
} finally {
  await browser.close();
  stop();
}
