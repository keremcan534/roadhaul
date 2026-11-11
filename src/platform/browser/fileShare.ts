/** What became of a file handed on: shared through the share sheet, downloaded, or the share sheet closed. */
export type FileHandedOn = 'shared' | 'saved' | 'cancelled';

/** How long the downloaded file's address is kept: long enough for the browser to start the download. */
const ADDRESS_KEPT_MS = 30_000;

/**
 * A file the game makes (photo mode's pictures, a company's backup) in a
 * browser: on a phone (a touch screen) the system's share sheet where the
 * browser offers one for files of its kind (the Web Share API), which also
 * saves a picture to the gallery; otherwise, or on a computer, a download.
 */
export async function shareFileInBrowser(window: Window, file: Blob, fileName: string, text: string): Promise<FileHandedOn> {
  const navigator = window.navigator;
  const named = new File([file], fileName, { type: file.type });
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch && typeof navigator.canShare === 'function' && navigator.canShare({ files: [named] })) {
    try {
      await navigator.share({ files: [named], text });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'cancelled';
      }
      // Refused (no share target, or not allowed now): downloaded instead.
    }
  }
  const address = URL.createObjectURL(file);
  const link = window.document.createElement('a');
  link.href = address;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(address), ADDRESS_KEPT_MS);
  return 'saved';
}
