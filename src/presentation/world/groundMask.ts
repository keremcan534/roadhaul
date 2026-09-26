import { DataTexture, LinearFilter, RedFormat, UnsignedByteType, Vector4 } from 'three';

/**
 * A mask over part of the ground, for the ground's shader: one channel, 8
 * bits a texel, filtered between texels; beyond its edges it holds its edge
 * texels' values.
 */
export interface GroundMask {
  readonly texture: DataTexture;
  /** Where it lies: at world (x, z) its uv is ((x - frame.x) * frame.z, (z - frame.y) * frame.w). */
  readonly frame: Vector4;
}

/** A texel grid over a box on the ground: how many texels each way, and where its corner lies. */
export interface MaskGrid {
  readonly width: number;
  readonly height: number;
  readonly minX: number;
  readonly minZ: number;
  readonly texelMeters: number;
}

/**
 * The grid of texels `texelMeters` apart covering the box from (minX, minZ)
 * to (maxX, maxZ), whole rows of 4 texels wide (so the rows upload
 * unpadded either way).
 */
export function maskGrid(minX: number, minZ: number, maxX: number, maxZ: number, texelMeters: number): MaskGrid {
  return {
    width: Math.ceil((maxX - minX) / texelMeters / 4) * 4,
    height: Math.ceil((maxZ - minZ) / texelMeters),
    minX,
    minZ,
    texelMeters,
  };
}

/** A mask from its texels over `grid` (row by row along x, from its corner). The caller disposes the texture. */
export function createGroundMask(data: Uint8Array, grid: MaskGrid): GroundMask {
  const texture = new DataTexture(data, grid.width, grid.height, RedFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  const frame = new Vector4(grid.minX, grid.minZ, 1 / (grid.width * grid.texelMeters), 1 / (grid.height * grid.texelMeters));
  return { texture, frame };
}
