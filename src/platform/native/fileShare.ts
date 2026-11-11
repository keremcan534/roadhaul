import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/** What became of a file handed on: shared through the share sheet, or the share sheet closed. */
export type FileHandedOn = 'shared' | 'cancelled';

/**
 * A file the game makes (photo mode's pictures, a company's backup) in the
 * Android app: written to a `folder` of the app's cache
 * (@capacitor/filesystem), emptied first so only the last is kept (Android
 * clears the cache too), and handed to Android's share sheet
 * (@capacitor/share), where the player saves it (a picture to the gallery, a
 * backup to their files or a drive) or sends it on. The entry point loads
 * this module only in the Android app, and only when a file is first shared.
 */
export async function shareFileInApp(file: Blob, fileName: string, folder: string, text: string, sheetTitle: string): Promise<FileHandedOn> {
  await Filesystem.rmdir({ path: folder, directory: Directory.Cache, recursive: true }).catch(() => undefined);
  const written = await Filesystem.writeFile({
    path: `${folder}/${fileName}`,
    data: await base64Of(file),
    directory: Directory.Cache,
    recursive: true,
  });
  try {
    await Share.share({ files: [written.uri], text, dialogTitle: sheetTitle });
    return 'shared';
  } catch (error) {
    // The plugin rejects with "Share canceled" when the sheet is closed.
    if (/cancel/i.test(error instanceof Error ? error.message : String(error))) {
      return 'cancelled';
    }
    throw error;
  }
}

/** The file's bytes in base64, as the plugin writes binary files. */
function base64Of(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}
