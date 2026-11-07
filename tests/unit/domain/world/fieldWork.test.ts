import { describe, expect, it } from 'vitest';
import { rectangleContains } from '../../../../src/data/definitions/MapDefinition';
import type { Field } from '../../../../src/domain/world/DrivingWorld';
import { createTractorPose, tractorAt, workedFields, type FieldWork } from '../../../../src/domain/world/fieldWork';

const FIELD: Field = { area: { x: 100, z: -40, headingDegrees: 30, lengthMeters: 160, widthMeters: 60 }, crop: 'ploughed' };

describe('field work', () => {
  it('works some ploughed and green fields, none with stubble or wheat, the same ones every time', () => {
    const fields: Field[] = Array.from({ length: 60 }, (_, i) => ({
      ...FIELD,
      crop: (['ploughed', 'green', 'stubble', 'wheat'] as const)[i % 4]!,
    }));
    const worked = workedFields(fields, 7);
    expect(worked.length).toBeGreaterThan(5);
    expect(worked.length).toBeLessThan(25);
    expect(worked.every((work) => ['ploughed', 'green'].includes(fields[work.field]!.crop))).toBe(true);
    expect(workedFields(fields, 7)).toEqual(worked);
  });

  it('drives up and down the field inside it, smoothly, facing the way it goes', () => {
    const work: FieldWork = { field: 0, startMeters: 0, speed: 3 };
    const pose = createTractorPose();
    const before = createTractorPose();
    tractorAt(FIELD, work, 0, before);
    for (let second = 0.5; second < 900; second += 0.5) {
      tractorAt(FIELD, work, second, pose);
      expect(rectangleContains(FIELD.area, pose.x, pose.z)).toBe(true);
      const moved = Math.hypot(pose.x - before.x, pose.z - before.z);
      // 1.5 m in half a second, a little less round a turn's chord.
      expect(moved).toBeGreaterThan(1.3);
      expect(moved).toBeLessThan(1.55);
      // Facing the way it moved, give or take the turn.
      const way = Math.atan2(pose.x - before.x, pose.z - before.z);
      const off = Math.abs(Math.atan2(Math.sin(way - pose.heading), Math.cos(way - pose.heading)));
      expect(off).toBeLessThan(0.3);
      before.x = pose.x;
      before.z = pose.z;
      before.heading = pose.heading;
    }
  });

  it('goes the whole width of the field, there and back', () => {
    const work: FieldWork = { field: 0, startMeters: 0, speed: 3 };
    const pose = createTractorPose();
    const across = new Set<number>();
    const heading = (FIELD.area.headingDegrees * Math.PI) / 180;
    for (let second = 0; second < 3000; second += 2) {
      tractorAt(FIELD, work, second, pose);
      const t = (pose.x - FIELD.area.x) * Math.cos(heading) - (pose.z - FIELD.area.z) * Math.sin(heading);
      across.add(Math.round(t / 7));
    }
    expect(across.size).toBeGreaterThanOrEqual(7);
  });
});
