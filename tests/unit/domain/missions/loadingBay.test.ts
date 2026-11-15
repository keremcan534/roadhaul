import { describe, expect, it } from 'vitest';
import { degreesToRadians } from '../../../../src/core/math/scalar';
import {
  bayParkingPose,
  isInsideBay,
  isParkedInBay,
  isParkedPerfectly,
  isTrailerParkedInBay,
  isTrailerParkedPerfectly,
} from '../../../../src/domain/missions/loadingBay';
import { vehicleFixture } from '../../../support/contentFixtures';

// A 16 × 4.6 m bay centred on the origin, running along X.
const bay = { x: 0, z: 0, headingDegrees: 90, lengthMeters: 16, widthMeters: 4.6 };
// 9 m long, 2.5 m wide; the body centre is 2.5 m (half the wheelbase) ahead of the rear axle.
const body = vehicleFixture().body;
/** A 12.5 m semi-trailer whose middle is 1.95 m ahead of its axles' middle (8.2 m to its front, less half its length). */
const trailer = { lengthMeters: 12.5, heightMeters: 4, couplingAheadMeters: 0.35, kingpinMeters: 1.2, axleBehindKingpinMeters: 7, axles: 3, massKg: 7000 };

/** The pose of a truck whose body centre is at (x, z), facing `headingDegrees`. */
function truck(x: number, z: number, headingDegrees: number, speed = 0) {
  const heading = degreesToRadians(headingDegrees);
  const back = body.wheelbaseMeters / 2;
  return { x: x - Math.sin(heading) * back, z: z - Math.cos(heading) * back, heading, speed };
}

describe('isInsideBay', () => {
  it('accepts a truck centred in the bay, facing either way along it', () => {
    expect(isInsideBay(bay, truck(0, 0, 90), body)).toBe(true);
    expect(isInsideBay(bay, truck(0, 0, -90), body)).toBe(true);
    expect(isInsideBay(bay, truck(0, 0, 270), body)).toBe(true);
  });

  it('needs the whole body inside: 3.5 m of play along the bay, 1.05 m across it', () => {
    expect(isInsideBay(bay, truck(3.4, 0, 90), body)).toBe(true);
    expect(isInsideBay(bay, truck(3.6, 0, 90), body)).toBe(false);
    expect(isInsideBay(bay, truck(-3.6, 0, -90), body)).toBe(false);
    expect(isInsideBay(bay, truck(0, 1, 90), body)).toBe(true);
    expect(isInsideBay(bay, truck(0, -1.1, 90), body)).toBe(false);
  });

  it('refuses a truck parked at an angle across the bay lines', () => {
    expect(isInsideBay(bay, truck(0, 0, 95), body)).toBe(true);
    expect(isInsideBay(bay, truck(0, 0, 110), body)).toBe(false);
    expect(isInsideBay(bay, truck(0, 0, 0), body)).toBe(false);
  });
});

describe('isParkedInBay', () => {
  it('needs the truck to stand still', () => {
    expect(isParkedInBay(bay, truck(0, 0, 90, 0), body)).toBe(true);
    expect(isParkedInBay(bay, truck(0, 0, 90, 0.2), body)).toBe(true);
    expect(isParkedInBay(bay, truck(0, 0, 90, -0.2), body)).toBe(true);
    expect(isParkedInBay(bay, truck(0, 0, 90, 0.5), body)).toBe(false);
    expect(isParkedInBay(bay, truck(0, 0, 90, -0.5), body)).toBe(false);
  });

  it('needs the truck inside the bay', () => {
    expect(isParkedInBay(bay, truck(10, 0, 90), body)).toBe(false);
  });

  it('takes a truck a little over the lines or askew: 1.5 m past an end, 0.8 m past a side, its corners within that', () => {
    // 3.5 m of play along the bay within its lines, and 1.5 more past them.
    expect(isParkedInBay(bay, truck(4.9, 0, 90), body)).toBe(true);
    expect(isParkedInBay(bay, truck(5.1, 0, 90), body)).toBe(false);
    // 1.05 m across within the lines, and 0.8 more.
    expect(isParkedInBay(bay, truck(0, 1.8, 90), body)).toBe(true);
    expect(isParkedInBay(bay, truck(0, -1.9, 90), body)).toBe(false);
    // Askew: 15° fits, 30° does not.
    expect(isParkedInBay(bay, truck(0, 0, 105), body)).toBe(true);
    expect(isParkedInBay(bay, truck(0, 0, 120), body)).toBe(false);
  });

  it('takes a semi-trailer as loosely, its axles\' middle at the pose', () => {
    const level = { x: -1.95, z: 0, heading: Math.PI / 2 };
    expect(isTrailerParkedInBay(bay, level, trailer, 2.5)).toBe(true);
    expect(isTrailerParkedInBay(bay, { ...level, z: 1.9 }, trailer, 2.5)).toBe(false);
  });
});

describe('isParkedPerfectly', () => {
  it('needs the truck within the lines, square to the bay and in its middle across it', () => {
    expect(isParkedPerfectly(bay, truck(0, 0, 90), body)).toBe(true);
    expect(isParkedPerfectly(bay, truck(0, 0, -90), body)).toBe(true);
    // Along the bay it may stand anywhere within the lines.
    expect(isParkedPerfectly(bay, truck(3, 0, 90), body)).toBe(true);
    expect(isParkedPerfectly(bay, truck(0, 0.4, 93), body)).toBe(true);
    expect(isParkedPerfectly(bay, truck(0, 0.6, 90), body)).toBe(false);
    expect(isParkedPerfectly(bay, truck(0, 0, 96), body)).toBe(false);
    // Parked, but over the lines.
    expect(isParkedPerfectly(bay, truck(4.5, 0, 90), body)).toBe(false);
  });

  it('judges a semi-trailer the same way', () => {
    expect(isTrailerParkedPerfectly(bay, { x: -1.95, z: 0, heading: Math.PI / 2 }, trailer, 2.5)).toBe(true);
    expect(isTrailerParkedPerfectly(bay, { x: -1.95, z: 0.7, heading: Math.PI / 2 }, trailer, 2.5)).toBe(false);
  });
});

describe('bayParkingPose', () => {
  it('parks the truck in the middle of the bay, facing along it', () => {
    const pose = bayParkingPose(bay, body);

    expect(isParkedInBay(bay, { ...pose, speed: 0 }, body)).toBe(true);
    expect(pose.heading).toBeCloseTo(Math.PI / 2, 12);
    // The body centre (half the wheelbase ahead of the rear axle) is the bay centre.
    expect(pose.x + Math.sin(pose.heading) * 2.5).toBeCloseTo(0, 9);
    expect(pose.z + Math.cos(pose.heading) * 2.5).toBeCloseTo(0, 9);
  });
});

