import { describe, expect, it } from 'vitest';
import type { TrailerBody } from '../../../../src/data/definitions/VehicleDefinition';
import {
  articulation,
  createTrailerFootprint,
  createTrailerPose,
  followCoupling,
  MAX_ARTICULATION_RADIANS,
  straightenTrailer,
  tractorForTrailerAt,
  trailerCentreAhead,
  trailerFrontAhead,
} from '../../../../src/domain/vehicles/semiTrailer';

const trailer: TrailerBody = {
  lengthMeters: 12.5,
  heightMeters: 4,
  couplingAheadMeters: 0.35,
  kingpinMeters: 1.2,
  axleBehindKingpinMeters: 7,
  axles: 3,
};

/** A tractor driving `meters` at `curvature` (1/m, positive turning left) in steps of 5 cm, from (0, 0) along +z. */
function drive(meters: number, curvature: number, reverse = false, startArticulation = 0) {
  const tractor = { x: 0, z: 0, heading: 0 };
  const pose = createTrailerPose();
  straightenTrailer(pose, tractor.x, tractor.z, tractor.heading, trailer);
  if (startArticulation !== 0) {
    pose.heading = startArticulation;
    const couplingZ = trailer.couplingAheadMeters;
    pose.x = -Math.sin(pose.heading) * trailer.axleBehindKingpinMeters;
    pose.z = couplingZ - Math.cos(pose.heading) * trailer.axleBehindKingpinMeters;
  }
  const step = reverse ? -0.05 : 0.05;
  let jackknifed = false;
  let worst = 0;
  for (let travelled = 0; travelled < meters; travelled += 0.05) {
    tractor.heading += step * curvature;
    tractor.x += Math.sin(tractor.heading) * step;
    tractor.z += Math.cos(tractor.heading) * step;
    jackknifed = followCoupling(pose, tractor.x, tractor.z, tractor.heading, trailer) || jackknifed;
    worst = Math.max(worst, Math.abs(articulation(pose, tractor.heading)));
  }
  return { tractor, pose, jackknifed, worst };
}

/** How far the trailer's axles are from the coupling: always its length. */
function couplingDistance(tractor: { x: number; z: number; heading: number }, pose: { x: number; z: number }): number {
  const x = tractor.x + Math.sin(tractor.heading) * trailer.couplingAheadMeters;
  const z = tractor.z + Math.cos(tractor.heading) * trailer.couplingAheadMeters;
  return Math.hypot(x - pose.x, z - pose.z);
}

describe('a semi-trailer', () => {
  it('stands straight behind the tractor, its axles its length behind the coupling', () => {
    const pose = createTrailerPose();
    straightenTrailer(pose, 10, 20, Math.PI / 2, trailer);

    expect(pose.heading).toBe(Math.PI / 2);
    expect(pose.x).toBeCloseTo(10 - (7 - 0.35), 9);
    expect(pose.z).toBeCloseTo(20, 9);
    // And the other way round: the tractor that stands it with its middle somewhere.
    const middle = { x: pose.x + trailerCentreAhead(trailer), z: pose.z };
    const tractor = tractorForTrailerAt(middle.x, middle.z, Math.PI / 2, trailer);
    expect(tractor.x).toBeCloseTo(10, 9);
    expect(tractor.z).toBeCloseTo(20, 9);
  });

  it('follows straight on a straight road', () => {
    const { tractor, pose, jackknifed } = drive(100, 0);

    expect(articulation(pose, tractor.heading)).toBeCloseTo(0, 9);
    expect(pose.x).toBeCloseTo(0, 9);
    expect(couplingDistance(tractor, pose)).toBeCloseTo(7, 9);
    expect(jackknifed).toBe(false);
  });

  it('falls in behind a straight tractor after a bend', () => {
    const { tractor, pose } = drive(200, 0, false, 0.6);

    expect(Math.abs(articulation(pose, tractor.heading))).toBeLessThan(0.01);
    expect(couplingDistance(tractor, pose)).toBeCloseTo(7, 9);
  });

  it('cuts inside a bend: its axles go round on a tighter circle than the tractor\'s', () => {
    const radius = 20;
    const { tractor, pose, jackknifed } = drive(2 * Math.PI * radius, 1 / radius);

    // Turning left, the trailer trails to the right of the tractor, at the angle a steady circle sets.
    const settled = articulation(pose, tractor.heading);
    expect(settled).toBeLessThan(0);
    const coupling = Math.hypot(radius, trailer.couplingAheadMeters);
    // The coupling, ahead of the rear axle, moves a little across the tractor; the trailer lags it by asin(L / r).
    expect(settled).toBeCloseTo(Math.atan(trailer.couplingAheadMeters / radius) - Math.asin(7 / coupling), 3);
    // The circle's centre is (radius, 0) for a tractor setting off along +z turning left (+x is its left).
    const trailerRadius = Math.hypot(pose.x - radius, pose.z);
    expect(trailerRadius).toBeLessThan(radius - 1);
    expect(trailerRadius).toBeCloseTo(Math.sqrt(coupling * coupling - 7 * 7), 1);
    expect(jackknifed).toBe(false);
  });

  it('turns ever further away when pushed in reverse, until it jackknifes and is held there', () => {
    const backed = drive(40, 0, true, 0.05);

    expect(backed.jackknifed).toBe(true);
    expect(backed.worst).toBeLessThanOrEqual(MAX_ARTICULATION_RADIANS + 1e-9);
    expect(Math.abs(articulation(backed.pose, backed.tractor.heading))).toBeCloseTo(MAX_ARTICULATION_RADIANS, 6);
    expect(couplingDistance(backed.tractor, backed.pose)).toBeCloseTo(7, 9);
    // Perfectly straight, it backs straight.
    const straight = drive(40, 0, true);
    expect(articulation(straight.pose, straight.tractor.heading)).toBeCloseTo(0, 9);
    expect(straight.jackknifed).toBe(false);
  });

  it('collides as a row of circles from its front to its rear', () => {
    const footprint = createTrailerFootprint(trailer, 2.55);
    const front = trailerFrontAhead(trailer);
    const rear = front - trailer.lengthMeters;

    expect(footprint.radius).toBe(1.275);
    expect(footprint.offsets.length).toBe(Math.ceil(12.5 / 2.55));
    expect(footprint.offsets[0]! - footprint.radius).toBeCloseTo(rear, 9);
    expect(footprint.offsets.at(-1)! + footprint.radius).toBeCloseTo(front, 9);
  });
});
