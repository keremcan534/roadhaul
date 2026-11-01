/** What became of a picture handed on: shared through the share sheet, downloaded, or the share sheet closed. */
export type PictureHandedOn = 'shared' | 'saved' | 'cancelled';

/** How long the downloaded picture's address is kept: long enough for the browser to start the download. */
const ADDRESS_KEPT_MS = 30_000;

/**
 * Photo mode's pictures in a browser: on a phone (a touch screen) the system's
 * share sheet where the browser offers one with files (the Web Share API),
 * which also saves to the gallery; otherwise, or on a computer, a download.
 */
export async function sharePictureInBrowser(window: Window, picture: Blob, fileName: string, text: string): Promise<PictureHandedOn> {
  const navigator = window.navigator;
  const file = new File([picture], fileName, { type: picture.type });
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'cancelled';
      }
      // Refused (no share target, or not allowed now): downloaded instead.
    }
  }
  const address = URL.createObjectURL(picture);
  const link = window.document.createElement('a');
  link.href = address;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(address), ADDRESS_KEPT_MS);
  return 'saved';
}
