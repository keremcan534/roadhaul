/** Size of the lookup grids that file things by where they are (trees, road pieces), meters. */
const GRID_CELL_METERS = 20;
/** Cells are numbered from here, so keys stay positive for maps up to ±80 km. */
const GRID_OFFSET = 4096;

/** The grid column (or row) of a coordinate. */
export function cellOf(coordinate: number): number {
  return Math.floor(coordinate / GRID_CELL_METERS);
}

/** One number per cell, to key a Map by (a small integer, so lookups allocate nothing). */
export function cellKey(cellX: number, cellZ: number): number {
  return (cellX + GRID_OFFSET) * GRID_OFFSET * 2 + (cellZ + GRID_OFFSET);
}
