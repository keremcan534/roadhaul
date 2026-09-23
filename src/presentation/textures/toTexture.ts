import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import type { PixelImage } from './pixelImage';

export interface TextureOptions {
  /** Tile the texture (ground, road, facades); otherwise clamp at the edges. */
  readonly repeat?: boolean;
  /** Colour images are sRGB; masks such as shadow alpha are not. Default true. */
  readonly srgb?: boolean;
  /** Sharper textures at grazing angles (ground and road). Capped by the GPU. */
  readonly anisotropy?: number;
}

/** Uploads a procedural image as a mipmapped three.js texture. The caller disposes it. */
export function toTexture(image: PixelImage, options: TextureOptions = {}): DataTexture {
  const texture = new DataTexture(image.data, image.width, image.height, RGBAFormat, UnsignedByteType);
  const wrap = options.repeat === true ? RepeatWrapping : ClampToEdgeWrapping;
  texture.wrapS = wrap;
  texture.wrapT = wrap;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = options.srgb === false ? NoColorSpace : SRGBColorSpace;
  texture.anisotropy = options.anisotropy ?? 1;
  texture.needsUpdate = true;
  return texture;
}
