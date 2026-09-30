import { describe, expect, it } from 'vitest';

/**
 * The store video (scripts/storeVideo.mjs, docs/RELEASE.md): its cut keeps to the beat, runs as long as Google Play
 * likes a promo video, and draws only footage the shoot takes.
 */
interface Timeline {
  readonly BEAT: number;
  readonly DURATION: number;
  readonly SCENES: Readonly<Record<string, number>>;
  readonly WORLD_CUTS: readonly number[];
  readonly FINALE_WORDS: readonly number[];
  readonly WHOOSHES: readonly number[];
  readonly TAPS: { readonly job: number; readonly paints: readonly number[]; readonly paint: number; readonly upgrade: number };
  readonly PAY_COUNT: readonly number[];
}
interface Shoot {
  readonly CLIPS: readonly { readonly id: string; readonly seconds: number; readonly speed?: number }[];
  readonly STILLS: readonly string[];
  readonly FPS: number;
}

const timeline = Object.values(import.meta.glob<Timeline>('/scripts/video/timeline.mjs', { eager: true }))[0]!;
const shoot = Object.values(import.meta.glob<Shoot>('/scripts/video/shoot.mjs', { eager: true }))[0]!;
const promo = Object.values(import.meta.glob<string>('/scripts/video/promo.js', { query: '?raw', import: 'default', eager: true }))[0]!;

const { BEAT, DURATION, SCENES } = timeline;
const onBeat = (time: number): boolean => Math.abs(time / BEAT - Math.round(time / BEAT)) < 1e-9;
const starts = Object.values(SCENES);
const sceneOf = (name: string): readonly [number, number] => {
  const index = starts.indexOf(SCENES[name]!);
  return [starts[index]!, starts[index + 1] ?? DURATION];
};

describe('the store video', () => {
  it('runs between 30 seconds and two minutes, and ends on a bar', () => {
    expect(DURATION).toBeGreaterThanOrEqual(30);
    expect(DURATION).toBeLessThanOrEqual(120);
    expect(onBeat(DURATION / 4)).toBe(true);
  });

  it('starts each scene on a bar, in order, with time for the brand at the end', () => {
    expect(starts[0]).toBe(0);
    for (const [index, start] of starts.entries()) {
      expect(onBeat(start / 4), `scene ${index}`).toBe(true);
      expect(start).toBeGreaterThan(starts[index - 1] ?? -1);
    }
    expect(DURATION - SCENES.end!).toBeGreaterThanOrEqual(5);
  });

  it('cuts the world montage and lands the finale\'s words on beats, inside their scenes', () => {
    for (const [name, times] of [
      ['world', timeline.WORLD_CUTS],
      ['finale', timeline.FINALE_WORDS],
    ] as const) {
      const [from, to] = sceneOf(name);
      for (const time of times) {
        expect(onBeat(time), `${name} ${time}`).toBe(true);
        expect(time).toBeGreaterThanOrEqual(from);
        expect(time).toBeLessThan(to);
      }
    }
    expect(timeline.WORLD_CUTS[0]).toBe(SCENES.world);
  });

  it('sounds its sweeps on scene cuts, its taps and its pay inside their scenes', () => {
    for (const time of timeline.WHOOSHES) {
      expect(starts).toContain(time);
    }
    const inside = (name: string, time: number): void => {
      const [from, to] = sceneOf(name);
      expect(time, name).toBeGreaterThan(from);
      expect(time, name).toBeLessThan(to);
    };
    inside('job', timeline.TAPS.job);
    const garage = [...timeline.TAPS.paints, timeline.TAPS.paint, timeline.TAPS.upgrade];
    garage.forEach((time, index) => {
      inside('garage', time);
      expect(time).toBeGreaterThan(garage[index - 1] ?? 0);
    });
    const [paidFrom, paidTo] = sceneOf('paid');
    expect(timeline.PAY_COUNT[0]).toBeGreaterThan(paidFrom);
    expect(timeline.PAY_COUNT[1]).toBeGreaterThan(timeline.PAY_COUNT[0]!);
    expect(timeline.PAY_COUNT[1]).toBeLessThan(paidTo);
  });

  it('draws only the clips and stills the shoot takes', () => {
    const clips = new Set(shoot.CLIPS.map((clip) => clip.id));
    const worldClips = /const WORLD_CLIPS = \[([^\]]*)\]/.exec(promo)?.[1] ?? '';
    const used = [...promo.matchAll(/film\('([a-z]+)'/g), ...worldClips.matchAll(/'([a-z]+)'/g)].map((match) => match[1]!);
    expect(used.length).toBeGreaterThan(0);
    for (const id of used) {
      expect(clips, id).toContain(id);
    }
    const stills = [...promo.matchAll(/(?:still|screen)\('([a-z0-9-]+)'/g)].map((match) => match[1]!);
    expect(stills.length).toBeGreaterThan(0);
    for (const name of stills) {
      expect(shoot.STILLS, name).toContain(name);
    }
  });

  it('shoots each world clip for at least its cut', () => {
    const worldClips = [...(/const WORLD_CLIPS = \[([^\]]*)\]/.exec(promo)?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((match) => match[1]!);
    expect(worldClips).toHaveLength(timeline.WORLD_CUTS.length);
    const cut = timeline.WORLD_CUTS[1]! - timeline.WORLD_CUTS[0]!;
    for (const id of worldClips) {
      const clip = shoot.CLIPS.find((entry) => entry.id === id)!;
      expect(clip.seconds, id).toBeGreaterThanOrEqual(cut + 4 / shoot.FPS);
    }
  });
});
