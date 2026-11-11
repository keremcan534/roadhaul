// The trailer's sound: the music (music.mjs) with the game's own sound under each shot that runs at its own pace
// (the engine, the air horn, the brakes' hiss, the rain, the delivery's chime), recorded as the shot was taken. The
// music steps back while the game is loud. storeVideo.mjs brings the mix to streaming loudness with ffmpeg.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLE_RATE, readWav } from './audio.mjs';

/** How loud the game's sound sits against the music, and how far the music ducks under it. */
const GAME_GAIN = 2.4;
const DUCK = 0.5;

/** Mixes `music` ({ left, right }) with the shots' sounds for `plan`'s clips, over `plan.duration`. */
export function mix(music, plan, shotsDir) {
  const length = Math.round(plan.duration * SAMPLE_RATE);
  const gameL = new Float32Array(length);
  const gameR = new Float32Array(length);
  for (const clip of plan.clips) {
    const gain = clip.sound ?? 1;
    const file = join(shotsDir, clip.shot, 'sound.wav');
    if (gain === 0 || clip.speed !== 1 || !existsSync(file)) continue;
    const { left, right } = readWav(readFileSync(file));
    const first = Math.round(clip.from * SAMPLE_RATE);
    const last = Math.min(length, Math.round((clip.to + (clip.tail ?? 0)) * SAMPLE_RATE));
    const offset = Math.round(clip.at * SAMPLE_RATE) - first;
    const fadeIn = 0.006 * SAMPLE_RATE;
    const fadeOut = (clip.tail ?? 0.03) * SAMPLE_RATE;
    for (let i = first; i < last; i++) {
      const at = i + offset;
      if (at < 0 || at >= left.length) continue;
      const envelope = Math.min(1, (i - first) / fadeIn, (last - i) / fadeOut);
      gameL[i] += left[at] * gain * envelope * GAME_GAIN;
      gameR[i] += right[at] * gain * envelope * GAME_GAIN;
    }
  }
  // The game's level, smoothed (10 ms attack, 250 ms release), ducks the music.
  const attack = Math.exp(-1 / (0.01 * SAMPLE_RATE));
  const release = Math.exp(-1 / (0.25 * SAMPLE_RATE));
  let level = 0;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const x = Math.max(Math.abs(gameL[i]), Math.abs(gameR[i]));
    level = x > level ? attack * level + (1 - attack) * x : release * level + (1 - release) * x;
    const duck = 1 - DUCK * Math.min(1, level * 2.5);
    const m = i < music.left.length ? 1 : 0;
    left[i] = (m ? music.left[i] : 0) * duck + gameL[i];
    right[i] = (m ? music.right[i] : 0) * duck + gameR[i];
  }
  return { left, right };
}
