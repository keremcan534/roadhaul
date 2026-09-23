/**
 * CSS rotation, in degrees within (-180, 180], of an arrow drawn pointing up
 * (straight ahead) that points from a truck at (x, z) facing `heading` toward
 * (aimX, aimZ). Headings grow to the left (0 faces +Z, 90° faces +X); CSS
 * rotates clockwise. Allocation-free.
 */
export function arrowRotationDegrees(x: number, z: number, heading: number, aimX: number, aimZ: number): number {
  const bearing = Math.atan2(aimX - x, aimZ - z);
  const degrees = ((heading - bearing) * 180) / Math.PI;
  const wrapped = (((degrees + 180) % 360) + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
}
