// Runs after every `npm install` / `npm ci`. Android Gradle plugin 9 refuses to configure a module that names
// `proguard-android.txt` (it turns R8's optimizations off), and two Capacitor plugins still name it in their release
// settings. Those modules are libraries that R8 does not run on, so what they name changes nothing in the game's build:
// the app's own rules (android/app/build.gradle) are what R8 uses. Drop this script once the plugins have moved on.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGINS = ['@capacitor-community/admob', '@capacitor-community/in-app-review'];

for (const plugin of PLUGINS) {
  const file = join(ROOT, 'node_modules', plugin, 'android', 'build.gradle');
  if (!existsSync(file)) {
    continue;
  }
  const before = readFileSync(file, 'utf8');
  const after = before.replaceAll("'proguard-android.txt'", "'proguard-android-optimize.txt'");
  if (after !== before) {
    writeFileSync(file, after);
  }
}
