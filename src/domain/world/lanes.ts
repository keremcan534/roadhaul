import type { RoadKind } from '../../data/definitions/MapDefinition';

/** A highway at least this wide is a motorway: three lanes each way either side of a median with its barrier. */
export const MOTORWAY_MIN_WIDTH_METERS = 22;
/** A motorway's median between its carriageways, meters (its barrier stands in the middle). */
export const MEDIAN_METERS = 3;

/** Whether a road of `kind` and `roadWidthMeters` is a motorway (MOTORWAY_MIN_WIDTH_METERS). */
export function isMotorway(kind: RoadKind, roadWidthMeters: number): boolean {
  return kind === 'highway' && roadWidthMeters >= MOTORWAY_MIN_WIDTH_METERS;
}

/** Lanes each way: three on a motorway, two on the highway, one elsewhere (matching the painted lines). */
export function lanesPerDirection(kind: RoadKind, roadWidthMeters = 0): number {
  return kind === 'highway' ? (isMotorway(kind, roadWidthMeters) ? 3 : 2) : 1;
}

/** The median between the carriageways, meters: a motorway's, else none. */
export function medianWidthMeters(kind: RoadKind, roadWidthMeters: number): number {
  return isMotorway(kind, roadWidthMeters) ? MEDIAN_METERS : 0;
}

export function laneWidthMeters(kind: RoadKind, roadWidthMeters: number): number {
  return (roadWidthMeters / 2 - medianWidthMeters(kind, roadWidthMeters) / 2) / lanesPerDirection(kind, roadWidthMeters);
}

/**
 * How far right of the centreline, in the direction of travel, the middle of
 * a lane lies. Traffic keeps right: lane 0 is the rightmost lane, lane 1 the
 * one left of it (the highway's overtaking lane), lane 2 a motorway's fast
 * lane by the median.
 */
export function laneOffsetMeters(kind: RoadKind, roadWidthMeters: number, laneIndex: number): number {
  return roadWidthMeters / 2 - laneWidthMeters(kind, roadWidthMeters) * (laneIndex + 0.5);
}
