import { drawBrand } from '../brand';
import { applyColorMatrix, photoColorMatrix, photoCssFilter, photoVignette, type PhotoFilterId } from './photoFilters';

/** The picture's JPEG quality: sharp, a few hundred kilobytes for a phone's screen. */
const JPEG_QUALITY = 0.92;
/** The brand in the corner: this share of the picture's shorter side tall, this share in from its edges. */
const BRAND_HEIGHT = 0.05;
const BRAND_MARGIN = 0.035;
/** Where the corners start to darken (the vignette), as a share of the way out to them: CSS's `transparent 55%`. */
const VIGNETTE_FROM = 0.55;

/**
 * Photo mode's picture: what `source` (the game's canvas, drawn just now) shows,
 * in the look picked, its corners darkened as the look has them and the brand
 * in a corner, as a JPEG. The copy from the canvas is made at once, so call it
 * right after the frame is drawn (RenderHost.capture); the encoding finishes
 * later.
 */
export function photoPicture(document: Document, source: HTMLCanvasElement, filter: PhotoFilterId): Promise<Blob> {
  const width = source.width;
  const height = source.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null || width === 0 || height === 0) {
    return Promise.reject(new Error('No picture to take.'));
  }
  context.drawImage(source, 0, 0);
  if (photoCssFilter(filter) !== 'none') {
    const image = context.getImageData(0, 0, width, height);
    applyColorMatrix(image.data, photoColorMatrix(filter));
    context.putImageData(image, 0, 0);
  }
  const vignette = photoVignette(filter);
  if (vignette > 0) {
    // CSS's `radial-gradient(ellipse, …)`: an ellipse as wide as the picture to its corners. Drawn as a circle in a
    // space squeezed across.
    context.save();
    context.translate(width / 2, height / 2);
    context.scale(width / height, 1);
    const reach = (height / 2) * Math.SQRT2;
    const gradient = context.createRadialGradient(0, 0, 0, 0, 0, reach);
    gradient.addColorStop(VIGNETTE_FROM, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(1, `rgba(0, 0, 0, ${vignette})`);
    context.fillStyle = gradient;
    context.fillRect(-height / 2, -height / 2, height, height);
    context.restore();
  }
  const shorter = Math.min(width, height);
  const margin = Math.round(shorter * BRAND_MARGIN);
  drawBrand(context, width - margin, height - margin, Math.round(shorter * BRAND_HEIGHT));
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        // Let the copy go at once: a phone's memory is short.
        canvas.width = 0;
        canvas.height = 0;
        if (blob === null) {
          reject(new Error('The picture could not be encoded.'));
        } else {
          resolve(blob);
        }
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}
