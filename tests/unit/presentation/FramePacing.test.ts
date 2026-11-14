import { describe, expect, it } from 'vitest';
import { FramePacing } from '../../../src/presentation/FramePacing';

/**
 * A phone whose frames take `frameMs(frame)` of work each on a `screenHz` screen, run for `seconds` under the pacing's
 * cap as the game loop applies it (GameLoop.due: a frame runs on the first beat at or after its due time). A frame at
 * work holds the screen's callbacks back until the beat after it ends, as the browser does. Returns the frames drawn.
 */
function run(pacing: FramePacing, screenHz: number, frameMs: (frame: number) => number, seconds: number): number {
  const beat = 1 / screenHz;
  let time = 0;
  let lastFrame = 0;
  let busyUntil = 0;
  let nextDue = Number.NaN;
  let lastBeat = 0;
  let drawn = 0;
  while (time < seconds) {
    time += beat;
    // A frame still at work holds the screen's callbacks back (the browser waits for it).
    if (time < busyUntil) {
      continue;
    }
    const cap = pacing.cap;
    if (cap > 0) {
      const interval = 1 / cap;
      if (Number.isNaN(nextDue) || time - nextDue > interval) {
        nextDue = time + interval;
      } else if (time < nextDue - 0.002) {
        lastBeat = time;
        continue;
      } else {
        nextDue += interval;
      }
    }
    const frameSeconds = lastFrame === 0 ? 0 : time - lastFrame;
    const beatSeconds = lastBeat === 0 ? 0 : time - lastBeat;
    lastBeat = time;
    lastFrame = time;
    drawn++;
    busyUntil = time + frameMs(drawn) / 1000;
    pacing.frame(frameSeconds, beatSeconds);
  }
  return drawn;
}

describe('FramePacing', () => {
  it('leaves a phone that keeps up with its screen alone', () => {
    const pacing = new FramePacing();
    run(pacing, 60, () => 12, 60);
    expect(pacing.screenFps).toBe(60);
    expect(pacing.cap).toBe(0);
    expect(pacing.paced).toBe(false);
  });

  it('paces a phone that draws about 40 frames a second on a 60 Hz screen, unevenly, at an even 30', () => {
    const pacing = new FramePacing();
    // One frame in time for the next beat, the next a beat late: 16.7 and 33.3 ms apart in turn.
    const uneven = (frame: number): number => (frame % 2 === 0 ? 14 : 22);
    run(pacing, 60, uneven, 10);
    expect(pacing.paced).toBe(true);
    expect(pacing.cap).toBe(30);
    expect(pacing.steadyCap).toBe(30);
    // Paced, every frame shows for two beats of the screen: 30 a second.
    const drawn = run(pacing, 60, uneven, 10);
    expect(drawn).toBeGreaterThanOrEqual(295);
    expect(drawn).toBeLessThanOrEqual(305);
  });

  it('keeps a phone that draws a little under its screen\'s rate unpaced', () => {
    const pacing = new FramePacing();
    // One frame in ten a beat late: about 55 a second, nearly all shown for one beat.
    run(pacing, 60, (frame) => (frame % 10 === 0 ? 20 : 15), 30);
    expect(pacing.paced).toBe(false);
  });

  it('paces a 120 Hz screen at 60, 40 or 30, keeping 75 frames a second and more unpaced', () => {
    const fast = new FramePacing();
    run(fast, 120, () => 7, 20);
    expect(fast.screenFps).toBe(120);
    expect(fast.paced).toBe(false);

    // 8.3 and 16.7 ms apart in turn: 80 a second, kept.
    const eighty = new FramePacing();
    run(eighty, 120, (frame) => (frame % 2 === 0 ? 7 : 10), 20);
    expect(eighty.paced).toBe(false);

    // 72 a second, the screen's beat seen on a lighter stretch before: an even 60.
    const sixty = new FramePacing();
    run(sixty, 120, () => 7, 3);
    run(sixty, 120, (frame) => (frame % 3 === 0 ? 7 : 14), 20);
    expect(sixty.cap).toBe(60);

    // About 48 a second: an even 40 once the screen's beat shows between paced frames and 40 has been tried.
    const forty = new FramePacing();
    run(forty, 120, (frame) => (frame % 2 === 0 ? 14 : 20), 60);
    expect(forty.screenFps).toBe(120);
    expect(forty.cap).toBe(40);

    // Never under 33 ms: an even 30, 40 tried and given up.
    const thirty = new FramePacing();
    run(thirty, 120, (frame) => (frame % 2 === 0 ? 26 : 28), 60);
    expect(thirty.cap).toBe(30);
  });

  it('tries the rate above again after a while, and keeps it once the phone keeps up', () => {
    const pacing = new FramePacing();
    // A heavy stretch (a city), then a light one (the highway).
    run(pacing, 60, (frame) => (frame % 2 === 0 ? 14 : 22), 10);
    expect(pacing.cap).toBe(30);
    run(pacing, 60, () => 10, 45);
    expect(pacing.paced).toBe(false);
    expect(pacing.cap).toBe(0);
  });

  it('tries less often each time the phone cannot keep up with the rate above', () => {
    const pacing = new FramePacing();
    let changes = 0;
    let wasCap = pacing.cap;
    const heavy = (frame: number): number => (frame % 2 === 0 ? 14 : 22);
    for (let i = 0; i < 600; i++) {
      run(pacing, 60, heavy, 1);
      if (pacing.cap !== wasCap) {
        changes++;
        wasCap = pacing.cap;
      }
    }
    // Ten minutes: paced once, then tries after 30, 60, 120, 240 and 480 s, each up and back down again.
    expect(pacing.steadyCap).toBe(30);
    expect(changes).toBeLessThanOrEqual(1 + 2 * 5);
    expect(changes).toBeGreaterThanOrEqual(1 + 2 * 3);
  });

  it('aims no higher than the player\'s cap, and does nothing under a cap of 30', () => {
    const capped = new FramePacing();
    capped.setCeiling(60);
    run(capped, 120, () => 12, 20);
    expect(capped.cap).toBe(60);
    expect(capped.paced).toBe(false);
    // 16.7 and 25 ms apart in turn: about 48 a second, an even 40 under the cap.
    run(capped, 120, (frame) => (frame % 2 === 0 ? 14 : 20), 60);
    expect(capped.cap).toBe(40);

    const thirty = new FramePacing();
    thirty.setCeiling(30);
    run(thirty, 60, () => 40, 20);
    expect(thirty.cap).toBe(30);
    expect(thirty.paced).toBe(false);
  });

  it('counts no hitch, and measures afresh after a pause, keeping the rate paced at', () => {
    const pacing = new FramePacing();
    const uneven = (frame: number): number => (frame % 2 === 0 ? 14 : 22);
    run(pacing, 60, uneven, 10);
    expect(pacing.cap).toBe(30);
    // A tab switch: one frame of seconds, not a measure.
    expect(pacing.frame(3, 3)).toBe(false);
    pacing.restart();
    run(pacing, 60, uneven, 4);
    expect(pacing.cap).toBe(30);
  });
});
