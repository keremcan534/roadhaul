import { describe, expect, it } from 'vitest';
import { arrowRotationDegrees } from '../../../../src/ui/hud/arrowRotation';

const DEG = Math.PI / 180;

describe('arrowRotationDegrees', () => {
  it('points straight up at a target dead ahead', () => {
    expect(arrowRotationDegrees(0, 0, 0, 0, 50)).toBeCloseTo(0, 9);
    expect(arrowRotationDegrees(10, 10, 90 * DEG, 60, 10)).toBeCloseTo(0, 9);
  });

  it('turns clockwise for a target on the right and anticlockwise for one on the left', () => {
    // Facing +Z, +X is on the left (turning left raises the heading toward +X).
    expect(arrowRotationDegrees(0, 0, 0, -50, 0)).toBeCloseTo(90, 9);
    expect(arrowRotationDegrees(0, 0, 0, 50, 0)).toBeCloseTo(-90, 9);
    expect(arrowRotationDegrees(0, 0, 0, -50, 50)).toBeCloseTo(45, 9);
  });

  it('points down at a target behind, and ignores whole turns of an unwrapped heading', () => {
    expect(Math.abs(arrowRotationDegrees(0, 0, 0, 0, -50))).toBeCloseTo(180, 9);
    expect(arrowRotationDegrees(0, 0, 4 * Math.PI, -50, 0)).toBeCloseTo(90, 9);
    expect(arrowRotationDegrees(0, 0, -6 * Math.PI, 50, 0)).toBeCloseTo(-90, 9);
  });
});
