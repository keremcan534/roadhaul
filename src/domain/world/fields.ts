import type { FieldDefinition, RectangleDefinition } from '../../data/definitions/MapDefinition';
import { createRoadPoint, type RoadPath } from './RoadPath';

/**
 * A field's rectangle beside its road (FieldDefinition): along the chord of
 * its stretch of road, set back from the road's edge where the road bulges
 * furthest toward it, so a bend never runs into the field.
 */
export function fieldArea(road: RoadPath, field: FieldDefinition): RectangleDefinition {
  const start = road.pointAt(field.fromMeters, createRoadPoint());
  const end = road.pointAt(field.fromMeters + field.lengthMeters, createRoadPoint());
  const chordX = end.x - start.x;
  const chordZ = end.z - start.z;
  const chord = Math.hypot(chordX, chordZ) || 1;
  const ux = chordX / chord;
  const uz = chordZ / chord;
  // Toward the field: right of the road's direction is (-uz, ux).
  const side = field.side === 'right' ? 1 : -1;
  const nx = -uz * side;
  const nz = ux * side;
  const middleX = (start.x + end.x) / 2;
  const middleZ = (start.z + end.z) / 2;
  // The centreline is straight between samples, so it bulges furthest at one of them (or at an end).
  let bulge = Math.max(
    0,
    (start.x - middleX) * nx + (start.z - middleZ) * nz,
    (end.x - middleX) * nx + (end.z - middleZ) * nz,
  );
  for (let i = 0; i < road.pointCount; i++) {
    const along = road.distances[i]! - field.fromMeters;
    const within = road.closed ? ((along % road.lengthMeters) + road.lengthMeters) % road.lengthMeters : along;
    if (within >= 0 && within <= field.lengthMeters) {
      bulge = Math.max(bulge, (road.x(i) - middleX) * nx + (road.z(i) - middleZ) * nz);
    }
  }
  const offset = bulge + road.widthMeters / 2 + field.setbackMeters + field.depthMeters / 2;
  return {
    x: middleX + nx * offset,
    z: middleZ + nz * offset,
    headingDegrees: (Math.atan2(ux, uz) * 180) / Math.PI,
    lengthMeters: chord,
    widthMeters: field.depthMeters,
  };
}
