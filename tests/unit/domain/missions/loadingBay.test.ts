import { describe, expect, it } from 'vitest';
import { degreesToRadians } from '../../../../src/core/math/scalar';
import { bayParkingPose, isInsideBay, isParkedInBay } from '../../../../src/domain/missions/loadingBay';
import { vehicleFixture } from '../../../support/contentFixtures';

// A 16 × 4.6 m bay centred on the origin, running along X.
const bay = { x: 0, z: 0, headingDegrees: 90, lengthMeters: 16, widthMeters: 4.6 };
// 9 m long, 2.5 m wide; the body centre is 2.5 m (half the wheelbase) ahead of the rear axle.
const body = vehicleFixture().body;

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

