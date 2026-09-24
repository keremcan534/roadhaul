import { PlaneGeometry, type BufferGeometry } from 'three';
import type { RectangleDefinition } from '../../data/definitions/MapDefinition';

/**
 * Lays a geometry drawn in the XY plane (X across, Y along) flat on the
 * ground: along the rectangle's heading, centred on it, at height `y`.
 */
export function placeFlat(geometry: BufferGeometry, rectangle: RectangleDefinition, y: number): BufferGeometry {
  // rotateX(-90°) maps +Y to -Z; rotateY(heading + 180°) then turns "along" to (sin h, cos h).
  return geometry
    .rotateX(-Math.PI / 2)
    .rotateY((rectangle.headingDegrees * Math.PI) / 180 + Math.PI)
    .translate(rectangle.x, y, rectangle.z);
}

/** A flat rectangle on the ground at height `y`, with texture coordinates in tiles of `tileMeters`. */
export function pavedRectangle(rectangle: RectangleDefinition, tileMeters: number, y: number): BufferGeometry {
  const geometry = new PlaneGeometry(rectangle.widthMeters, rectangle.lengthMeters);
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) * rectangle.widthMeters) / tileMeters, (uv.getY(i) * rectangle.lengthMeters) / tileMeters);
  }
  return placeFlat(geometry, rectangle, y);
}
