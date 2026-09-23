import type { RoadKind } from '../../data/definitions/MapDefinition';

/** Lanes each way: two on the highway, one elsewhere (matching the painted lines). */
export function lanesPerDirection(kind: RoadKind): number {
  return kind === 'highway' ? 2 : 1;
}

export function laneWidthMeters(kind: RoadKind, roadWidthMeters: number): number {
  return roadWidthMeters / 2 / lanesPerDirection(kind);
}

/**
 * How far right of the centreline, in the direction of travel, the middle of
 * a lane lies. Traffic keeps right: lane 0 is the rightmost lane, lane 1 the
 * one left of it (the highway's overtaking lane).
 */
export function laneOffsetMeters(kind: RoadKind, roadWidthMeters: number, laneIndex: number): number {
  return roadWidthMeters / 2 - laneWidthMeters(kind, roadWidthMeters) * (laneIndex + 0.5);
}
