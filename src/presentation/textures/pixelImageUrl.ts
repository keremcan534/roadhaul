import type { PixelImage } from './pixelImage';

/** `image` (y up) as a PNG data URL for an <img>, drawn through a canvas of `document`. Not per frame. */
export function pixelImageUrl(document: Document, image: PixelImage): string {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (context === null) {
    return '';
  }
  const pixels = context.createImageData(image.width, image.height);
  const row = image.width * 4;
  // The picture's first row is its bottom; the canvas's is its top.
  for (let y = 0; y < image.height; y++) {
    pixels.data.set(image.data.subarray(y * row, (y + 1) * row), (image.height - 1 - y) * row);
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png');
}
