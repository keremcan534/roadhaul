import { distanceToForestEdge, forestContains, type Forest } from '../../domain/world/forests';
import { createGroundMask, maskGrid, type GroundMask } from './groundMask';

/** The forest floor's mask has a texel this far apart, meters: its edge is soft. */
const TEXEL_METERS = 8;
/**
 * The floor darkens from this far outside a forest's edge, where the edge
 * trees' crowns shade it, to the full forest floor this far inside, meters.
 */
const SHADE_OUTSIDE_METERS = 5;
const SHADE_INSIDE_METERS = 7;

/**
 * Where the ground is the forests' floor: a small texture over their
 * extent, 1 under the trees deep in a forest (fallen needles and leaves in
 * the crowns' shade), fading to 0 just outside its edge. The ground's
 * shader darkens the grass by it (TrackView). Null for no forests. The
 * caller disposes the texture.
 */
export function createForestFloorMask(forests: readonly Forest[]): GroundMask | null {
  if (forests.length === 0) {
    return null;
  }
  const reach = SHADE_OUTSIDE_METERS + TEXEL_METERS * 2;
  const grid = maskGrid(
    Math.min(...forests.map((forest) => forest.minX)) - reach,
    Math.min(...forests.map((forest) => forest.minZ)) - reach,
    Math.max(...forests.map((forest) => forest.maxX)) + reach,
    Math.max(...forests.map((forest) => forest.maxZ)) + reach,
    TEXEL_METERS,
  );
  const data = new Uint8Array(grid.width * grid.height);
  for (let row = 0; row < grid.height; row++) {
    const z = grid.minZ + (row + 0.5) * TEXEL_METERS;
    for (let column = 0; column < grid.width; column++) {
      const x = grid.minX + (column + 0.5) * TEXEL_METERS;
      let shade = 0;
      for (const forest of forests) {
        if (x < forest.minX - reach || x > forest.maxX + reach || z < forest.minZ - reach || z > forest.maxZ + reach) {
          continue;
        }
        // How far in from the edge (out of it, negative).
        const depth = distanceToForestEdge(forest, x, z) * (forestContains(forest, x, z) ? 1 : -1);
        shade = Math.max(shade, (depth + SHADE_OUTSIDE_METERS) / (SHADE_OUTSIDE_METERS + SHADE_INSIDE_METERS));
      }
      data[row * grid.width + column] = Math.round(Math.min(1, Math.max(0, shade)) * 255);
    }
  }
  return createGroundMask(data, grid);
}
