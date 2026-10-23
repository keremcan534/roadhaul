import type { EngineLoop } from './EngineSound';
import diesel650 from './engine/diesel-650.ogg';
import diesel900 from './engine/diesel-900.ogg';
import diesel1250 from './engine/diesel-1250.ogg';
import diesel1750 from './engine/diesel-1750.ogg';
import diesel2450 from './engine/diesel-2450.ogg';

/** Every loop is this long, seconds (scripts/engineLoops.mjs). */
const LOOP_SECONDS = 6;

/**
 * The engine's loops, each the engine running steadily at one speed, rpm.
 * scripts/engineLoops.mjs makes them from a recording of a diesel truck
 * idling ("Diesel Truck Idling Front" by ibirdfilm on Freesound, CC0): the
 * idle as recorded, and the faster ones from the same firing pulses laid
 * closer together, so the revs rise without the engine shrinking.
 */
const LOOPS: readonly { readonly rpm: number; readonly url: string }[] = [
  { rpm: 650, url: diesel650 },
  { rpm: 900, url: diesel900 },
  { rpm: 1250, url: diesel1250 },
  { rpm: 1750, url: diesel1750 },
  { rpm: 2450, url: diesel2450 },
];

/** Fetches the engine's loops (shipped with the game) and decodes them for `context`. */
export function loadEngineLoops(context: BaseAudioContext): Promise<EngineLoop[]> {
  return Promise.all(
    LOOPS.map(async ({ rpm, url }) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`${url}: HTTP ${response.status}`);
      }
      return { rpm, buffer: await context.decodeAudioData(await response.arrayBuffer()), seconds: LOOP_SECONDS };
    }),
  );
}
