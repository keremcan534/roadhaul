import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../../src/data/content/maps';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';

/**
 * The country a map grows (villages, side roads, farms, fields) grows from
 * the map alone: the game's ?spawn= moves where the truck starts, and must
 * not move a road, a house or a field.
 */
const region = MAPS[0]!;
const world = new DrivingWorld(region);
// Out in the country the map grew, halfway along one of its lanes, facing across it.
const lane = world.roads.find((road) => road.kind === 'lane')!;
const halfway = lane.pointCount >> 1;
const spawn = { x: lane.x(halfway), z: lane.z(halfway), headingDegrees: 45 };
const moved = new DrivingWorld({ ...region, spawn });

/** Each road's id and samples. */
function roadsOf(of: DrivingWorld): { id: string; kind: string; points: number[] }[] {
  return of.roads.map((road) => ({ id: road.id, kind: road.kind, points: Array.from(road.points) }));
}

describe('the country a map grows', () => {
  it('moves the truck where it is asked to start', () => {
    expect(moved.spawn.x).toBe(spawn.x);
    expect(moved.spawn.z).toBe(spawn.z);
    expect(Math.hypot(moved.spawn.x - world.spawn.x, moved.spawn.z - world.spawn.z)).toBeGreaterThan(100);
  });

  it('grows the same roads wherever the truck starts: the same ids, in the same order, through the same samples', () => {
    expect(world.roads.length).toBeGreaterThan(world.mapRoadCount);
    expect(moved.mapRoadCount).toBe(world.mapRoadCount);
    expect(roadsOf(moved)).toEqual(roadsOf(world));
    expect(moved.network.junctions).toEqual(world.network.junctions);
    expect(moved.network.deadEnds).toEqual(world.network.deadEnds);
    expect(moved.turningCircles).toEqual(world.turningCircles);
  });

  it('grows the same villages, buildings, fields and parks wherever the truck starts', () => {
    expect(world.villages.length).toBeGreaterThan(0);
    expect(world.buildings.some((building) => building.country === true)).toBe(true);
    expect(world.fields.length).toBeGreaterThan(region.fields.length);
    expect(world.parks.length).toBeGreaterThan((region.parks ?? []).length);
    expect(moved.villages).toEqual(world.villages);
    expect(moved.buildings).toEqual(world.buildings);
    expect(moved.fields).toEqual(world.fields);
    expect(moved.parks).toEqual(world.parks);
  });

  it('joins every road it grew to the rest: every road can be reached from every other through the junctions', () => {
    expect(world.network.componentCount).toBe(1);
    // Road by road: from the map's first road, on through every junction.
    const reached = new Set([0]);
    const queue = [0];
    while (queue.length > 0) {
      const road = queue.shift()!;
      for (const junction of world.network.junctions) {
        if (junction.members.some((member) => member.roadIndex === road)) {
          for (const { roadIndex } of junction.members) {
            if (!reached.has(roadIndex)) {
              reached.add(roadIndex);
              queue.push(roadIndex);
            }
          }
        }
      }
    }
    const unreached = world.roads.filter((_, index) => !reached.has(index)).map((road) => road.id);
    expect(unreached).toEqual([]);
    // Each road it grew meets another at one end at least.
    for (let index = world.mapRoadCount; index < world.roads.length; index++) {
      const road = world.roads[index]!;
      const ends = [0, road.pointCount - 1].filter((sampleIndex) =>
        world.network.junctions.some((junction) =>
          junction.members.some((member) => member.roadIndex === index && member.sampleIndex === sampleIndex),
        ),
      );
      expect(ends.length, road.id).toBeGreaterThan(0);
    }
  });
});
