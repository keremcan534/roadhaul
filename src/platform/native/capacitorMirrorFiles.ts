import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { MirrorFiles } from './mirroredStorage';

/**
 * The mirror's files in the Android app: `files/roadhaul/` in the app's own storage (@capacitor/filesystem's Data
 * directory), the folder Android's backup rules carry (res/xml/data_extraction_rules.xml, backup_rules.xml). The
 * entry point loads this module only in the Android app.
 */
const FOLDER = 'roadhaul';

export const capacitorMirrorFiles: MirrorFiles = {
  async read(name) {
    try {
      const { data } = await Filesystem.readFile({ path: `${FOLDER}/${name}`, directory: Directory.Data, encoding: Encoding.UTF8 });
      return typeof data === 'string' ? data : await data.text();
    } catch {
      return null; // No file yet.
    }
  },
  async write(name, text) {
    await Filesystem.writeFile({ path: `${FOLDER}/${name}`, data: text, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
  },
  async remove(name) {
    await Filesystem.deleteFile({ path: `${FOLDER}/${name}`, directory: Directory.Data }).catch(() => undefined);
  },
};
