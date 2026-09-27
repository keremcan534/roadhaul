import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../../src/data/content/maps';
import type { RectangleDefinition, VillageDefinition } from '../../../../src/data/definitions/MapDefinition';
import { findBridges } from '../../../../src/domain/world/bridges';
import { CountryPlan, JUNCTION_REACH_METERS, ROAD_CLEARANCE_METERS } from '../../../../src/domain/world/countryPlan';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { OpenLand } from '../../../../src/domain/world/openLand';
import { RoadGrid } from '../../../../src/domain/world/RoadGrid';
import { RoadNetwork } from '../../../../src/domain/world/RoadNetwork';
import { RoadPath } from '../../../../src/domain/world/RoadPath';
import { growVillages } from '../../../../src/domain/world/villages';

const region = MAPS[0]!;
const villages = region.villages ?? [];
const world = new DrivingWorld(region);

/** The region's land and its own roads, as DrivingWorld hands them to its CountryPlan. */
const regionRoads = world.roads.slice(0, world.mapRoadCount);
const regionLand = new OpenLand({
  halfSizeMeters: region.halfSizeMeters,
  shoreline: region.sea?.shoreline ?? null,
  rivers: world.rivers,
  forests: world.forests,
  parks: region.parks ?? [],
  fields: world.fields.slice(0, region.fields.length),
  yards: [...region.depots.map((depot) => depot.yard), ...region.restAreas.map((restArea) => restArea.lot)],
  buildings: world.buildings.filter((building) => building.country !== true),
  windTurbines: world.windTurbines,
  citySigns: world.citySigns,
  bridges: findBridges(regionRoads, world.rivers),
});

/** The region's villages grown on their own from `seed`, with nothing else grown yet, and those that grew. */
function villagesOnly(seed: number): CountryPlan & { readonly grown: readonly { id: string }[] } {
  const plan = new CountryPlan(regionLand, regionRoads);
  return Object.assign(plan, { grown: growVillages(plan, villages, seed) });
}

const grownAlone = villagesOnly(77);
const grownAgain = villagesOnly(77);

function roadNamed(roads: readonly RoadPath[], id: string): { road: RoadPath; index: number } | undefined {
  const index = roads.findIndex((road) => road.id === id);
  return index < 0 ? undefined : { road: roads[index]!, index };
}

/** The roads with a sample exactly at (x, z), but `except`: where a road ending there meets them. */
function roadsThrough(roads: readonly RoadPath[], x: number, z: number, except: readonly number[]): number[] {
  const through: number[] = [];
  roads.forEach((road, index) => {
    if (except.includes(index)) {
      return;
    }
    for (let i = 0; i < road.pointCount; i++) {
      if (road.x(i) === x && road.z(i) === z) {
        through.push(index);
        return;
      }
    }
  });
  return through;
}

/** Whether the network joins roads `a` and `b` at (x, z). */
function meetAt(network: RoadNetwork, a: number, b: number, x: number, z: number): boolean {
  return network.junctions.some(
    (junction) =>
      Math.hypot(junction.x - x, junction.z - z) < 1e-6 &&
      junction.members.some((member) => member.roadIndex === a) &&
      junction.members.some((member) => member.roadIndex === b),
  );
}

/** How far (x, z) lies from a rectangle, meters: 0 inside it. */
function distanceToArea(area: RectangleDefinition, x: number, z: number): number {
  const heading = (area.headingDegrees * Math.PI) / 180;
  const along = (x - area.x) * Math.sin(heading) + (z - area.z) * Math.cos(heading);
  const across = (x - area.x) * Math.cos(heading) - (z - area.z) * Math.sin(heading);
  return Math.hypot(Math.max(0, Math.abs(along) - area.lengthMeters / 2), Math.max(0, Math.abs(across) - area.widthMeters / 2));
}

/** Where (x, z) lies from a village's middle: along its street and across it, meters. */
function fromMiddle(village: VillageDefinition, x: number, z: number): { along: number; across: number } {
  const heading = (village.headingDegrees * Math.PI) / 180;
  const dx = x - village.x;
  const dz = z - village.z;
  return { along: dx * Math.sin(heading) + dz * Math.cos(heading), across: dx * Math.cos(heading) - dz * Math.sin(heading) };
}

describe(`the villages of the ${region.id} region`, () => {
  it('grows every village the map places, where it places it, in order', () => {
    expect(villages.length).toBeGreaterThan(5);
    expect(world.villages).toEqual(villages.map(({ id, x, z }) => ({ id, x, z })));
  });

  it("lays each village's street through its middle, square to the map along its heading", () => {
    for (const village of villages) {
      const found = roadNamed(world.roads, `${village.id}_street`);
      expect(found, village.id).toBeDefined();
      const { road: street, index } = found!;
      const last = street.pointCount - 1;
      expect(index, village.id).toBeGreaterThanOrEqual(world.mapRoadCount);
      expect(street.kind, village.id).toBe('street');
      expect(street.closed, village.id).toBe(false);
      expect(street.lengthMeters, village.id).toBeGreaterThanOrEqual(160);
      expect(street.distanceTo(village.x, village.z), village.id).toBeLessThan(1e-6);
      const { along } = fromMiddle(village, street.x(last), street.z(last));
      expect(along, village.id).toBeCloseTo(street.lengthMeters / 2, 6);
      for (let i = 0; i <= last; i++) {
        expect(Math.abs(fromMiddle(village, street.x(i), street.z(i)).across), village.id).toBeLessThan(1e-6);
      }
    }
  });

  it('leads a country road out of one end of its street to a junction on another country road', () => {
    for (const village of villages) {
      const { road: street, index: streetIndex } = roadNamed(world.roads, `${village.id}_street`)!;
      const found = roadNamed(world.roads, `${village.id}_road_1`);
      expect(found, village.id).toBeDefined();
      const { road, index } = found!;
      const end = road.pointCount - 1;
      expect(road.kind).toBe('rural');
      expect(index).toBe(streetIndex + 1);
      // It leaves one end of the street, exactly.
      const streetEnds = [0, street.pointCount - 1].filter((i) => street.x(i) === road.x(0) && street.z(i) === road.z(0));
      expect(streetEnds, village.id).toHaveLength(1);
      expect(meetAt(world.network, index, streetIndex, road.x(0), road.z(0)), village.id).toBe(true);
      // And ends on another country road, exactly on one of its samples, where the network joins them.
      const joined = roadsThrough(world.roads, road.x(end), road.z(end), [index, streetIndex]);
      expect(joined, village.id).toHaveLength(1);
      const other = world.roads[joined[0]!]!;
      expect(other.kind, village.id).toBe('rural');
      expect(other.closed, village.id).toBe(false);
      expect(joined[0], village.id).toBeLessThan(index);
      expect(meetAt(world.network, index, joined[0]!, road.x(end), road.z(end)), village.id).toBe(true);
    }
  });

  it("leads a second road out of the street's other end where one reaches another road, else turns the street round there", () => {
    let seconds = 0;
    for (const village of villages) {
      const { road: street, index: streetIndex } = roadNamed(world.roads, `${village.id}_street`)!;
      const first = roadNamed(world.roads, `${village.id}_road_1`)!;
      const firstEnd = street.x(0) === first.road.x(0) && street.z(0) === first.road.z(0) ? 0 : street.pointCount - 1;
      const otherEnd = firstEnd === 0 ? street.pointCount - 1 : 0;
      const second = roadNamed(world.roads, `${village.id}_road_2`);
      if (second === undefined) {
        expect(
          world.turningCircles.some((circle) => circle.roadIndex === streetIndex && circle.sampleIndex === otherEnd),
          village.id,
        ).toBe(true);
        continue;
      }
      seconds++;
      const { road, index } = second;
      const end = road.pointCount - 1;
      expect(road.kind).toBe('rural');
      expect(road.x(0), village.id).toBe(street.x(otherEnd));
      expect(road.z(0), village.id).toBe(street.z(otherEnd));
      expect(meetAt(world.network, index, streetIndex, road.x(0), road.z(0)), village.id).toBe(true);
      const joined = roadsThrough(world.roads, road.x(end), road.z(end), [index, streetIndex, first.index]);
      expect(joined, village.id).toHaveLength(1);
      expect(world.roads[joined[0]!]!.kind, village.id).toBe('rural');
      expect(meetAt(world.network, index, joined[0]!, road.x(end), road.z(end)), village.id).toBe(true);
      expect(world.turningCircles.some((circle) => circle.roadIndex === streetIndex), village.id).toBe(false);
    }
    expect(seconds).toBeGreaterThan(villages.length / 2);
  });

  it("joins every village's street to the map's roads through junctions: the roads make one network", () => {
    expect(world.network.componentCount).toBe(1);
    // Road by road, from the map's first road.
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
    for (const village of villages) {
      expect(reached.has(roadNamed(world.roads, `${village.id}_street`)!.index), village.id).toBe(true);
    }
  });

  it('keeps its streets and roads 38 m from every road there before them, but within 60 m of where they meet one', () => {
    const grids = world.roads.map((road) => new RoadGrid([road], ROAD_CLEARANCE_METERS));
    const crowded: string[] = [];
    for (const village of villages) {
      for (const id of [`${village.id}_street`, `${village.id}_road_1`, `${village.id}_road_2`]) {
        const found = roadNamed(world.roads, id);
        if (found === undefined) {
          continue;
        }
        const { road, index } = found;
        const junctions = world.network.junctions.filter((junction) => junction.members.some((member) => member.roadIndex === index));
        for (let i = 0; i < road.pointCount; i++) {
          const x = road.x(i);
          const z = road.z(i);
          if (junctions.some((junction) => Math.hypot(junction.x - x, junction.z - z) < JUNCTION_REACH_METERS)) {
            continue;
          }
          for (let other = 0; other < index; other++) {
            if (grids[other]!.nearRoad(x, z, ROAD_CLEARANCE_METERS - 0.5)) {
              crowded.push(`${id}[${i}] by ${world.roads[other]!.id}`);
            }
          }
        }
      }
    }
    expect(crowded).toEqual([]);
  });

  it('stands about as many houses as the map asks for beside each street, back from its edge, within 250 m of its middle', () => {
    for (const village of villages) {
      const { road: street } = roadNamed(world.roads, `${village.id}_street`)!;
      const houses = world.buildings.filter((building) => {
        const x = (building.minX + building.maxX) / 2;
        const z = (building.minZ + building.maxZ) / 2;
        const { along, across } = fromMiddle(village, x, z);
        return building.country === true && Math.abs(along) <= street.lengthMeters / 2 && Math.abs(across) < 21;
      });
      expect(houses.length, village.id).toBeGreaterThanOrEqual(village.houses / 2);
      expect(houses.length, village.id).toBeLessThanOrEqual(village.houses + 4);
      for (const house of houses) {
        const x = (house.minX + house.maxX) / 2;
        const z = (house.minZ + house.maxZ) / 2;
        expect(Math.hypot(x - village.x, z - village.z), village.id).toBeLessThan(250);
        // Their walls 6.5 m and more from the street's edge.
        const walls = Math.min(
          ...[house.minX, house.maxX].flatMap((wallX) => [house.minZ, house.maxZ].map((wallZ) => street.distanceTo(wallX, wallZ))),
        );
        expect(walls - street.widthMeters / 2, village.id).toBeGreaterThanOrEqual(6.5 - 1e-6);
      }
    }
  });

  it('lays out a green beside the middle of the street of each village that asks for one, and of no other', () => {
    for (const village of villages) {
      const green = world.parks.find((park) => park.id === `${village.id}_green`);
      if (village.green !== true) {
        expect(green, village.id).toBeUndefined();
        continue;
      }
      expect(green, village.id).toBeDefined();
      const { road: street } = roadNamed(world.roads, `${village.id}_street`)!;
      const { along, across } = fromMiddle(village, green!.area.x, green!.area.z);
      expect(green!.area.headingDegrees, village.id).toBe(village.headingDegrees);
      expect(along, village.id).toBeCloseTo(0, 6);
      expect(Math.abs(across), village.id).toBeGreaterThan(30);
      expect(Math.abs(across), village.id).toBeLessThan(50);
      for (let i = 0; i < street.pointCount; i++) {
        expect(distanceToArea(green!.area, street.x(i), street.z(i)) - street.widthMeters / 2, village.id).toBeGreaterThanOrEqual(6 - 1e-6);
      }
    }
  });
});

describe('growVillages', () => {
  it("grows every one of the region's villages from another seed too, each street with its roads, all joined up", () => {
    expect(grownAlone.grown.map((village) => village.id)).toEqual(villages.map((village) => village.id));
    for (const village of villages) {
      const street = roadNamed(grownAlone.roads, `${village.id}_street`);
      expect(street, village.id).toBeDefined();
      expect(roadNamed(grownAlone.roads, `${village.id}_road_1`)?.index, village.id).toBe(street!.index + 1);
      // Where it grows among the rest, its street lies where it does alone.
      expect(Array.from(roadNamed(world.roads, `${village.id}_street`)!.road.points), village.id).toEqual(Array.from(street!.road.points));
    }
    expect(new RoadNetwork(grownAlone.roads).componentCount).toBe(1);
  });

  it('grows the same villages from the same seed', () => {
    expect(grownAgain.newRoads.map((road) => road.id)).toEqual(grownAlone.newRoads.map((road) => road.id));
    grownAgain.newRoads.forEach((road, index) => {
      expect(Array.from(road.points), road.id).toEqual(Array.from(grownAlone.newRoads[index]!.points));
    });
    expect(grownAgain.buildings).toEqual(grownAlone.buildings);
    expect(grownAgain.parks).toEqual(grownAlone.parks);
    expect(grownAgain.circles).toEqual(grownAlone.circles);
  });

  it('lines each street with about as many houses as the map asks for, a few metres back from it, every house by one street', () => {
    const perVillage = new Map(villages.map((village) => [village.id, 0]));
    for (const house of grownAlone.buildings) {
      const beside = villages.filter((village) => {
        const { along, across } = fromMiddle(village, house.x, house.z);
        const { road: street } = roadNamed(grownAlone.roads, `${village.id}_street`)!;
        return Math.abs(along) <= street.lengthMeters / 2 - 30 + 1e-6 && Math.abs(across) >= 11 && Math.abs(across) <= 21;
      });
      expect(beside, `house at ${house.x}, ${house.z}`).toHaveLength(1);
      perVillage.set(beside[0]!.id, perVillage.get(beside[0]!.id)! + 1);
    }
    for (const village of villages) {
      expect(perVillage.get(village.id), village.id).toBeGreaterThanOrEqual(village.houses / 2);
      expect(perVillage.get(village.id), village.id).toBeLessThanOrEqual(village.houses + 4);
    }
    // Houses on both sides of a street with no green beside it.
    for (const village of villages.filter((candidate) => candidate.green !== true)) {
      const sides = new Set(
        grownAlone.buildings
          .map((house) => fromMiddle(village, house.x, house.z))
          .filter(({ along, across }) => Math.abs(along) < 150 && Math.abs(across) <= 21)
          .map(({ across }) => Math.sign(across)),
      );
      expect(sides, village.id).toEqual(new Set([-1, 1]));
    }
  });
});

describe('growVillages on open land', () => {
  const empty = (halfSizeMeters: number): OpenLand =>
    new OpenLand({
      halfSizeMeters,
      shoreline: null,
      rivers: [],
      forests: [],
      parks: [],
      fields: [],
      yards: [],
      buildings: [],
      windTurbines: [],
      citySigns: [],
      bridges: [],
    });
  // A country road across a 3 km map, bending north a little in the middle.
  const countryRoad = new RoadPath({
    id: 'country_road',
    kind: 'rural',
    widthMeters: 8,
    closed: false,
    controlPoints: [
      [-1300, 0],
      [0, 40],
      [1300, 0],
    ],
  });
  const northEnd: VillageDefinition = { id: 'north_end', x: 0, z: 500, headingDegrees: 0, houses: 8, green: true };
  const eastEnd: VillageDefinition = { id: 'east_end', x: 700, z: -500, headingDegrees: 90, houses: 12 };
  const westEnd: VillageDefinition = { id: 'west_end', x: -700, z: -400, headingDegrees: 180, houses: 4, green: true };

  function grow(list: readonly VillageDefinition[], seed: number, roads: readonly RoadPath[] = [countryRoad], half = 1500): CountryPlan & { grown: unknown } {
    const plan = new CountryPlan(empty(half), roads);
    return Object.assign(plan, { grown: growVillages(plan, list, seed) });
  }

  it('grows a village by a country road: its street, a road out to the road, houses and a green', () => {
    const plan = grow([northEnd], 1);
    const street = roadNamed(plan.roads, 'north_end_street')!.road;
    const road = roadNamed(plan.roads, 'north_end_road_1')!.road;
    const end = road.pointCount - 1;

    expect(plan.grown).toEqual([{ id: 'north_end', x: 0, z: 500 }]);
    expect(plan.newRoads.map((newRoad) => newRoad.id)).toEqual(['north_end_street', 'north_end_road_1']);
    // Heading 0: the street runs north along x = 0, the road out leaves its south end, toward the country road.
    expect(street.x(0)).toBe(0);
    expect(street.z(0)).toBeLessThan(street.z(street.pointCount - 1));
    expect([road.x(0), road.z(0)]).toEqual([street.x(0), street.z(0)]);
    expect(roadsThrough(plan.roads, road.x(end), road.z(end), [1, 2])).toEqual([0]);
    expect(new RoadNetwork(plan.roads).componentCount).toBe(1);
    // No road lies ahead of its north end: the street turns round there.
    expect(plan.circles).toHaveLength(1);
    expect(plan.circles[0]![0]).toBeCloseTo(0, 9);
    expect(plan.circles[0]![1]).toBeCloseTo(street.z(street.pointCount - 1) + 2, 9);
    expect(plan.buildings.length).toBeGreaterThanOrEqual(4);
    expect(plan.parks.map((park) => park.id)).toEqual(['north_end_green']);
  });

  it('lays a street along x for a village heading 90°, and back along z for one heading 180°', () => {
    const plan = grow([eastEnd, westEnd], 1);
    const east = roadNamed(plan.roads, 'east_end_street')!.road;
    const west = roadNamed(plan.roads, 'west_end_street')!.road;

    for (let i = 0; i < east.pointCount; i++) {
      expect(east.z(i)).toBe(-500);
    }
    expect(east.x(east.pointCount - 1)).toBeGreaterThan(east.x(0));
    for (let i = 0; i < west.pointCount; i++) {
      expect(west.x(i)).toBe(-700);
    }
    expect(west.z(west.pointCount - 1)).toBeLessThan(west.z(0));
    // The more houses, the longer the street.
    expect(east.lengthMeters).toBeGreaterThan(west.lengthMeters);
  });

  it('leads roads out of both ends where both can reach a road, to different places', () => {
    const plan = grow([eastEnd], 1);
    const first = roadNamed(plan.roads, 'east_end_road_1')!.road;
    const second = roadNamed(plan.roads, 'east_end_road_2')!.road;
    const street = roadNamed(plan.roads, 'east_end_street')!.road;
    const ends = new Set([`${street.x(0)},${street.z(0)}`, `${street.x(street.pointCount - 1)},${street.z(street.pointCount - 1)}`]);

    expect(new Set([`${first.x(0)},${first.z(0)}`, `${second.x(0)},${second.z(0)}`])).toEqual(ends);
    const firstEnd = first.pointCount - 1;
    const secondEnd = second.pointCount - 1;
    expect(Math.hypot(first.x(firstEnd) - second.x(secondEnd), first.z(firstEnd) - second.z(secondEnd))).toBeGreaterThan(140);
    expect(plan.circles).toEqual([]);
    expect(new RoadNetwork(plan.roads).componentCount).toBe(1);
  });

  it('leaves out a village with no room for its street, or with no country road it can reach, adding nothing', () => {
    const onTheRoad = grow([{ id: 'on_the_road', x: 0, z: 30, headingDegrees: 90, houses: 8 }], 1);
    const highStreet = new RoadPath({
      id: 'high_street',
      kind: 'street',
      widthMeters: 10,
      closed: false,
      controlPoints: [
        [-1300, 0],
        [1300, 0],
      ],
    });
    const byAStreet = grow([northEnd], 1, [highStreet]);
    const farRoad = new RoadPath({
      id: 'far_road',
      kind: 'rural',
      widthMeters: 8,
      closed: false,
      controlPoints: [
        [-3800, -3500],
        [3800, -3500],
      ],
    });
    const remote = grow([{ id: 'remote', x: 0, z: 3000, headingDegrees: 0, houses: 8 }], 1, [farRoad], 4000);

    for (const plan of [onTheRoad, byAStreet, remote]) {
      expect(plan.grown).toEqual([]);
      expect(plan.newRoads).toEqual([]);
      expect(plan.buildings).toEqual([]);
      expect(plan.parks).toEqual([]);
      expect(plan.circles).toEqual([]);
    }
  });

  it('grows the villages in turn: one with no room beside those grown before it is left out', () => {
    const crowded: VillageDefinition = { id: 'crowded', x: 20, z: 520, headingDegrees: 90, houses: 8 };

    expect(grow([northEnd, crowded], 1).grown).toEqual([{ id: 'north_end', x: 0, z: 500 }]);
    expect(grow([crowded, northEnd], 1).grown).toEqual([{ id: 'crowded', x: 20, z: 520 }]);
  });

  it('grows the same villages from the same seed, winding their roads and sizing their houses from it', () => {
    const list = [northEnd, eastEnd, westEnd];
    const summary = (plan: CountryPlan): unknown => ({
      roads: plan.newRoads.map((road) => ({ id: road.id, points: Array.from(road.points) })),
      buildings: plan.buildings,
      parks: plan.parks,
      circles: plan.circles,
    });
    const once = summary(grow(list, 1));

    expect(summary(grow(list, 1))).toEqual(once);
    expect(summary(grow(list, 2))).not.toEqual(once);
  });
});
