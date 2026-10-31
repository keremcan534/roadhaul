import { describe, expect, it } from 'vitest';
import { LANGUAGES as GAME_LANGUAGES } from '../../../src/data/config/languages';

/**
 * The store trailer (scripts/storeVideo.mjs, docs/RELEASE.md): its cut keeps to the beat, fits what Google Play
 * autoplays, shows only shots the shoot takes, and says nothing in any language that a listing's video may not.
 */
interface Timeline {
  readonly BEAT: number;
  readonly BARS: number;
  readonly DURATION: number;
  readonly SECTIONS: readonly { readonly id: string; readonly from: number }[];
  readonly HITS: { readonly horn: number; readonly drop: number; readonly finale: readonly number[]; readonly brand: number };
}
interface CutList {
  readonly CUT: readonly { readonly shot: string; readonly from: number; readonly at?: number; readonly mark?: string }[];
  readonly WORDS: readonly { readonly key: string; readonly from: number; readonly to: number; readonly place?: string }[];
}
interface Captions {
  readonly LANGUAGES: Readonly<Record<string, string>>;
  readonly CAPTIONS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
}

const module = <T>(modules: Record<string, T>): T => Object.values(modules)[0]!;
const timeline = module(import.meta.glob<Timeline>('/scripts/trailer/timeline.mjs', { eager: true }));
const { CUT, WORDS } = module(import.meta.glob<CutList>('/scripts/trailer/cutList.mjs', { eager: true }));
const { LANGUAGES, CAPTIONS } = module(import.meta.glob<Captions>('/scripts/trailer/captions.mjs', { eager: true }));
const listings = new Set(
  Object.keys(import.meta.glob('/fastlane/metadata/android/*/title.txt')).map((path) => path.split('/')[4]),
);
const edit = module(import.meta.glob<string>('/scripts/trailer/edit.mjs', { query: '?raw', import: 'default', eager: true }));

const BEATS = timeline.BARS * 4;
const whole = (beat: number): boolean => Number.isInteger(beat);

describe('the store trailer', () => {
  it('runs the 30 seconds Google Play autoplays, on whole bars', () => {
    expect(timeline.DURATION).toBeCloseTo(30, 9);
    expect(timeline.BARS * 4 * timeline.BEAT).toBeCloseTo(timeline.DURATION, 9);
  });

  it('cuts on beats, in order, from the first frame to the brand', () => {
    expect(CUT[0]!.from).toBe(0);
    CUT.forEach((clip, index) => {
      expect(whole(clip.from), clip.shot).toBe(true);
      expect(clip.from).toBeLessThan(BEATS);
      expect(clip.from).toBeGreaterThan(CUT[index - 1]?.from ?? -1);
    });
    expect(CUT.map((clip) => clip.from)).toContain(timeline.HITS.brand);
    // The brand holds at least three seconds at the end.
    expect((BEATS - timeline.HITS.brand) * timeline.BEAT).toBeGreaterThanOrEqual(3);
  });

  it('starts the music\'s sections on bars, and lands the finale\'s words on beats in its own', () => {
    for (const section of timeline.SECTIONS) {
      expect(section.from % 4, section.id).toBe(0);
    }
    const finale = timeline.SECTIONS.find((section) => section.id === 'finale')!.from;
    for (const hit of timeline.HITS.finale) {
      expect(whole(hit)).toBe(true);
      expect(hit).toBeGreaterThanOrEqual(finale);
      expect(hit).toBeLessThan(timeline.HITS.brand);
    }
  });

  it('shows only shots the shoot takes', () => {
    const shots = new Set([...edit.matchAll(/^ {4}id: '([a-z0-9]+)',$/gm)].map((match) => match[1]));
    expect(shots.size).toBeGreaterThan(0);
    for (const clip of CUT) {
      expect(shots, clip.shot).toContain(clip.shot);
    }
  });

  it('puts one caption on screen at a time, long enough to read, before the finale', () => {
    WORDS.forEach((word, index) => {
      expect(CAPTIONS[word.key], word.key).toBeDefined();
      expect(word.to).toBeGreaterThan(word.from);
      expect((word.to - word.from) * timeline.BEAT, word.key).toBeGreaterThanOrEqual(1.4);
      expect(word.from).toBeGreaterThanOrEqual(WORDS[index - 1]?.to ?? 0);
      expect(word.to).toBeLessThanOrEqual(timeline.HITS.finale[0]!);
    });
  });

  it('speaks every language of the game, each for a listing the store kit has', () => {
    expect(Object.keys(LANGUAGES).sort()).toEqual([...GAME_LANGUAGES].sort());
    for (const locale of Object.values(LANGUAGES)) {
      expect(listings, locale).toContain(locale);
    }
    for (const [key, byLanguage] of Object.entries(CAPTIONS)) {
      for (const lang of GAME_LANGUAGES) {
        const lines = byLanguage[lang];
        expect(lines, `${key} ${lang}`).toBeDefined();
        expect(lines!.join('').trim(), `${key} ${lang}`).not.toBe('');
      }
    }
    for (const lang of GAME_LANGUAGES) {
      expect(CAPTIONS.finale![lang], lang).toHaveLength(timeline.HITS.finale.length);
    }
  });

  it('sells nothing: no price, ranking or call to action in any language (Google Play\'s rules for a listing\'s video)', () => {
    const forbidden =
      /\b(free|gratis|gratuit|grátis|kostenlos|darmow|ücretsiz|бесплатн|download|install|play now|best|#1|new|discount|sale)\b|indir|ücretsiz|бесплатн|скача/i;
    for (const [key, byLanguage] of Object.entries(CAPTIONS)) {
      for (const [lang, lines] of Object.entries(byLanguage)) {
        expect(lines.join(' '), `${key} ${lang}`).not.toMatch(forbidden);
      }
    }
  });
});
