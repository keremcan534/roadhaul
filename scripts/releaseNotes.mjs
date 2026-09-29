// Prints every store listing language's release notes in the form Google
// Play Console's release notes box takes, each between its language's tags:
//
//   node scripts/releaseNotes.mjs        the notes every release shares (changelogs/default.txt)
//   node scripts/releaseNotes.mjs 57     build 57's own (changelogs/57.txt) where a language has them
//
// The notes live in fastlane/metadata/android/<locale>/changelogs (docs/RELEASE.md).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LISTINGS = join(dirname(fileURLToPath(import.meta.url)), '../fastlane/metadata/android');
/** Google Play's limit for a language's release notes, in characters. */
const LIMIT = 500;

const build = process.argv[2];
const blocks = [];
for (const locale of readdirSync(LISTINGS).sort()) {
  const folder = join(LISTINGS, locale, 'changelogs');
  const file = [build === undefined ? null : join(folder, `${build}.txt`), join(folder, 'default.txt')].find(
    (path) => path !== null && existsSync(path),
  );
  if (file === undefined) {
    continue;
  }
  const text = readFileSync(file, 'utf8').trim();
  if ([...text].length > LIMIT) {
    throw new Error(`${file}: Google Play takes at most ${LIMIT} characters of release notes.`);
  }
  blocks.push(`<${locale}>\n${text}\n</${locale}>`);
}
console.log(blocks.join('\n'));
