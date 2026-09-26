import type { RoadPath } from '../../domain/world/RoadPath';

/**
 * How far a road's drawn ribbons (asphalt, shoulders, lines) may stray from
 * the road they follow, meters: where a road runs straight or bends gently,
 * a ribbon skips samples and runs straight between the ones it keeps.
 */
export const RIBBON_TOLERANCE_METERS = 0.04;
/** The longest a ribbon runs straight between two kept samples, meters. */
export const RIBBON_MAX_SPAN_METERS = 48;

/**
 * The rows of a road's samples a ribbon along it keeps: its ends, both sides
 * of every change in `keep` (where a painted line stops short of a junction),
 * and enough between for the ribbon to stay within `toleranceMeters` of the
 * centreline (Douglas–Peucker), at most `maxSpanMeters` apart along it. Rows
 * count samples from 0; a closed road has one row more than samples, its
 * first again, so the ribbon closes its loop. Ascending.
 */
export function ribbonRows(
  road: RoadPath,
  toleranceMeters = RIBBON_TOLERANCE_METERS,
  maxSpanMeters = RIBBON_MAX_SPAN_METERS,
  keep?: (sampleIndex: number) => boolean,
): number[] {
  const count = road.pointCount;
  const last = road.closed ? count : count - 1;
  if (last <= 0) {
    return last === 0 ? [0] : [];
  }
  const x = (row: number): number => road.x(row % count);
  const z = (row: number): number => road.z(row % count);
  const along = (row: number): number => (row === count ? road.lengthMeters : (road.distances[row] ?? 0));
  const kept = new Uint8Array(last + 1);
  kept[0] = 1;
  kept[last] = 1;
  if (keep !== undefined) {
    for (let row = 0; row < last; row++) {
      if (keep(row % count) !== keep((row + 1) % count)) {
        kept[row] = 1;
        kept[row + 1] = 1;
      }
    }
  }
  // Douglas–Peucker between each pair of rows kept so far: keep the row furthest from the chord while it strays too far.
  const stack: number[] = [];
  let start = 0;
  for (let row = 1; row <= last; row++) {
    if (kept[row] === 1) {
      stack.push(start, row);
      start = row;
    }
  }
  while (stack.length > 0) {
    const to = stack.pop()!;
    const from = stack.pop()!;
    const ax = x(from);
    const az = z(from);
    const dx = x(to) - ax;
    const dz = z(to) - az;
    const lengthSquared = dx * dx + dz * dz;
    let furthest = -1;
    let furthestDistance = toleranceMeters;
    for (let row = from + 1; row < to; row++) {
      const px = x(row) - ax;
      const pz = z(row) - az;
      const t = lengthSquared > 0 ? Math.max(0, Math.min(1, (px * dx + pz * dz) / lengthSquared)) : 0;
      const distance = Math.hypot(px - dx * t, pz - dz * t);
      if (distance > furthestDistance) {
        furthest = row;
        furthestDistance = distance;
      }
    }
    if (furthest >= 0) {
      kept[furthest] = 1;
      stack.push(from, furthest, furthest, to);
    }
  }
  // No run longer than the span: a longer one keeps the last row before each span is reached.
  const rows: number[] = [0];
  let previous = 0;
  for (let row = 1; row <= last; row++) {
    if (kept[row] === 1 || along(Math.min(row + 1, last)) - along(previous) > maxSpanMeters) {
      rows.push(row);
      previous = row;
    }
  }
  return rows;
}
