import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/** What became of a picture handed on: shared through the share sheet, or the share sheet closed. */
export type PictureHandedOn = 'shared' | 'cancelled';

/** The app's cache folder for the pictures: emptied before each one, so only the last is kept (Android clears it too). */
const FOLDER = 'photos';

/**
 * Photo mode's pictures in the Android app: written to the app's cache
 * (@capacitor/filesystem) and handed to Android's share sheet
 * (@capacitor/share), where the player saves them to the gallery or sends
 * them on. The entry point loads this module only in the Android app, and only
 * when a picture is first taken.
 */
export async function sharePictureInApp(picture: Blob, fileName: string, text: string, sheetTitle: string): Promise<PictureHandedOn> {
  await Filesystem.rmdir({ path: FOLDER, directory: Directory.Cache, recursive: true }).catch(() => undefined);
  const written = await Filesystem.writeFile({
    path: `${FOLDER}/${fileName}`,
    data: await base64Of(picture),
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

/** The picture's bytes in base64, as the plugin writes binary files. */
function base64Of(picture: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('The picture could not be read.'));
    reader.readAsDataURL(picture);
  });
}
