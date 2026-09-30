import { describe, expect, it } from 'vitest';
import { LANGUAGES, languageOfTag } from '../../../src/data/config/languages';

/**
 * The Google Play listing (fastlane/metadata/android/<locale>, docs/RELEASE.md): one for each language the game
 * speaks, every text within the store's limits, and screenshots in each: Google Play takes a listing with two or more,
 * and at most eight.
 */
const ROOT = '/fastlane/metadata/android';
const texts = import.meta.glob<string>('/fastlane/metadata/android/**/*.txt', { query: '?raw', import: 'default', eager: true });
const screenshots = Object.keys(import.meta.glob('/fastlane/metadata/android/*/images/phoneScreenshots/*.{jpg,png}'));
const images = Object.keys(import.meta.glob('/fastlane/metadata/android/en-US/images/*.{jpg,png}'));

/** Google Play's limits, in characters. */
const LIMITS: Readonly<Record<string, number>> = {
  'title.txt': 30,
  'short_description.txt': 80,
  'full_description.txt': 4000,
  'changelogs/default.txt': 500,
};

const localeOf = (path: string): string => path.slice(ROOT.length + 1).split('/')[0] ?? '';
const locales = [...new Set(Object.keys(texts).map(localeOf))].sort();

describe('the Google Play listing', () => {
  it('is written in each language the game speaks, and in no other', () => {
    expect(locales.map((locale) => languageOfTag(locale)).sort()).toEqual([...LANGUAGES].sort());
  });

  it.each(locales)('%s: has every text, each within its limit', (locale) => {
    for (const [file, limit] of Object.entries(LIMITS)) {
      const text = texts[`${ROOT}/${locale}/${file}`];
      expect(text, file).toBeDefined();
      const length = [...(text ?? '').trim()].length;
      expect(length, file).toBeGreaterThan(0);
      expect(length, file).toBeLessThanOrEqual(limit);
    }
  });

  it.each(locales)('%s: has two to eight screenshots', (locale) => {
    const count = screenshots.filter((path) => localeOf(path) === locale).length;
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(8);
  });

  it('has the icon and the feature graphic every language shares', () => {
    expect(images.map((path) => path.split('/').pop())).toEqual(expect.arrayContaining(['icon.png', 'featureGraphic.jpg']));
  });
});
