import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../../src/data/content/maps';
import {
  rectangleContains,
  rectangleCorners,
  type MapDefinition,
  type Point2,
  type RectangleDefinition,
} from '../../../../src/data/definitions/MapDefinition';
import { findBridges } from '../../../../src/domain/world/bridges';
import { CountryPlan, JUNCTION_REACH_METERS, ROAD_CLEARANCE_METERS } from '../../../../src/domain/world/countryPlan';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { fieldArea } from '../../../../src/domain/world/fields';
import { distanceToForestEdge, forestContains } from '../../../../src/domain/world/forests';
import { OpenLand, type LandParts } from '../../../../src/domain/world/openLand';
import { RoadGrid } from '../../../../src/domain/world/RoadGrid';
import { RoadNetwork, TURNING_CIRCLE_RADIUS_METERS } from '../../../../src/domain/world/RoadNetwork';
import { RoadPath } from '../../../../src/domain/world/RoadPath';
import {
  angleFrom,
  controlPointsBefore,
  growSideRoads,
  LANE_WIDTH_METERS,
  layFarmland,
  sampleAt,
  tangentAt,
} from '../../../../src/domain/world/sideRoads';
import { mapFixture } from '../../../support/contentFixtures';

/**
 * A small country: three country roads meeting in the middle of a 3 km
 * map, with a pine wood, a park, a wheat field, a house, a wind turbine and
 * a river about, and five side roads a kilometre.
 */
const countryMap: MapDefinition = mapFixture({
  halfSizeMeters: 1500,
  roads: [
    {
      id: 'west_road',
      kind: 'rural',
      widthMeters: 8,
      closed: false,
      controlPoints: [
        [-1350, -100],
        [-700, 40],
        [0, 0],
      ],
    },
    {
      id: 'east_road',
      kind: 'rural',
      widthMeters: 8,
      closed: false,
      controlPoints: [
        [0, 0],
        [700, -60],
        [1350, 90],
      ],
    },
    {
      id: 'north_road',
      kind: 'rural',
      widthMeters: 8,
      closed: false,
      controlPoints: [
        [0, 0],
        [60, 700],
        [-40, 1350],
      ],
    },
  ],
  buildings: [{ x: -400, z: 300, widthMeters: 20, depthMeters: 14, heightMeters: 6 }],
  depots: [],
  forests: [
    {
      id: 'north_wood',
      kind: 'pine',
      outline: [
        [-1100, 200],
        [-600, 250],
        [-650, 700],
        [-1150, 650],
      ],
    },
  ],
  parks: [{ id: 'east_park', area: { x: 700, z: 400, headingDegrees: 0, lengthMeters: 120, widthMeters: 90 } }],
  fields: [{ roadId: 'east_road', fromMeters: 200, lengthMeters: 300, side: 'left', setbackMeters: 10, depthMeters: 100, crop: 'wheat' }],
  windTurbines: [{ x: 400, z: -500 }],
  rivers: [
    {
      id: 'south_river',
      widthMeters: 20,
      points: [
        [-1500, -700],
        [0, -900],
        [1500, -650],
      ],
    },
  ],
  spawn: { x: 0, z: 10, headingDegrees: 0 },
  scenery: { seed: 3, treesPerKilometer: 0, sideRoadsPerKilometer: 5 },
});
const countryWorld = new DrivingWorld(countryMap);
const region = MAPS[0]!;
const regionWorld = new DrivingWorld(region);

/** The land a world's country grows on, and the map's own roads: what DrivingWorld hands its CountryPlan. */
interface Country {
  readonly land: OpenLand;
  readonly mapRoads: readonly RoadPath[];
}

function countryOf(world: DrivingWorld, map: MapDefinition): Country {
  const mapRoads = world.roads.slice(0, world.mapRoadCount);
  const land = new OpenLand({
    halfSizeMeters: map.halfSizeMeters,
    shoreline: map.sea?.shoreline ?? null,
    rivers: world.rivers,
    forests: world.forests,
    parks: map.parks ?? [],
    fields: world.fields.slice(0, map.fields.length),
    yards: [...map.depots.map((depot) => depot.yard), ...map.restAreas.map((restArea) => restArea.lot)],
    buildings: world.buildings.filter((building) => building.country !== true),
    windTurbines: world.windTurbines,
    citySigns: world.citySigns,
    bridges: findBridges(mapRoads, world.rivers),
  });
  return { land, mapRoads };
}

/** Land with nothing on it. */
function emptyLand(halfSizeMeters: number): OpenLand {
  const nothing: LandParts = {
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
  };
  return new OpenLand(nothing);
}

/** What has grown, the map's roads first, and their network. */
interface Grown {
  readonly roads: readonly RoadPath[];
  readonly mapRoadCount: number;
  readonly network: RoadNetwork;
}

function lanesOf(grown: Grown): { lane: RoadPath; index: number }[] {
  return grown.roads.map((lane, index) => ({ lane, index })).filter(({ lane }) => lane.kind === 'lane');
}

/** Every sample of every road but `except` that lies exactly on (x, z). */
function samplesAt(roads: readonly RoadPath[], x: number, z: number, except: number): { roadIndex: number; sampleIndex: number }[] {
  const found: { roadIndex: number; sampleIndex: number }[] = [];
  roads.forEach((road, roadIndex) => {
    if (roadIndex === except) {
      return;
    }
    for (let i = 0; i < road.pointCount; i++) {
      if (road.x(i) === x && road.z(i) === z) {
        found.push({ roadIndex, sampleIndex: i });
      }
    }
  });
  return found;
}

/** The lanes that do not leave a country road or an earlier lane at a T-junction, square to it, exactly on one of its samples. */
function misplacedStarts(grown: Grown): string[] {
  const misplaced: string[] = [];
  for (const { lane, index } of lanesOf(grown)) {
    // The parent runs on through the junction (a lane crossing it the other way starts there too).
    const parents = samplesAt(grown.roads, lane.x(0), lane.z(0), index).filter(
      ({ roadIndex, sampleIndex }) => sampleIndex > 0 && sampleIndex < grown.roads[roadIndex]!.pointCount - 1,
    );
    if (parents.length !== 1) {
      misplaced.push(`${lane.id} leaves ${parents.length} roads`);
      continue;
    }
    const { roadIndex, sampleIndex } = parents[0]!;
    const parent = grown.roads[roadIndex]!;
    if (parent.closed || (parent.kind !== 'rural' && parent.kind !== 'lane') || roadIndex >= index) {
      misplaced.push(`${lane.id} leaves ${parent.id}`);
    }
    const meets = grown.network.junctions.some(
      (junction) =>
        junction.members.some((member) => member.roadIndex === index && member.sampleIndex === 0) &&
        junction.members.some((member) => member.roadIndex === roadIndex && member.sampleIndex === sampleIndex),
    );
    if (!meets) {
      misplaced.push(`${lane.id} does not meet ${parent.id}`);
    }
    // Its way out: its curve's direction at the junction, from its first three samples (a second-order
    // difference: they lie on the curve's first piece, equal steps of it apart).
    const [tangentX, tangentZ] = tangentAt(parent, sampleIndex);
    const outX = -3 * lane.x(0) + 4 * lane.x(1) - lane.x(2);
    const outZ = -3 * lane.z(0) + 4 * lane.z(1) - lane.z(2);
    const along = (outX * tangentX + outZ * tangentZ) / Math.hypot(outX, outZ);
    if (Math.abs(along) > 0.1) {
      misplaced.push(`${lane.id} leaves ${parent.id} ${along.toFixed(2)} along it`);
    }
  }
  return misplaced;
}

/** The lanes whose far end neither joins another road exactly on one of its samples nor is a dead end. */
function misplacedEnds(grown: Grown): { misplaced: string[]; joins: number } {
  const misplaced: string[] = [];
  let joins = 0;
  for (const { lane, index } of lanesOf(grown)) {
    const end = lane.pointCount - 1;
    const joined = samplesAt(grown.roads, lane.x(end), lane.z(end), index).length > 0;
    const deadEnd = grown.network.deadEnds.some((candidate) => candidate.roadIndex === index && candidate.sampleIndex === end);
    if (joined) {
      joins++;
    }
    if (joined === deadEnd) {
      misplaced.push(`${lane.id} ${joined ? 'joins a road at a dead end' : 'ends nowhere'}`);
    }
    if (grown.network.deadEnds.some((candidate) => candidate.roadIndex === index && candidate.sampleIndex === 0)) {
      misplaced.push(`${lane.id} leaves no road`);
    }
  }
  return { misplaced, joins };
}

/**
 * The lanes' samples nearer than ROAD_CLEARANCE_METERS (less half a metre)
 * to the edge of a road there before them, but within JUNCTION_REACH_METERS
 * of where they meet a road.
 */
function crowdedSamples(grown: Grown): string[] {
  const grids = grown.roads.map((road) => new RoadGrid([road], ROAD_CLEARANCE_METERS));
  const crowded: string[] = [];
  for (const { lane, index } of lanesOf(grown)) {
    const junctions = grown.network.junctions.filter((junction) => junction.members.some((member) => member.roadIndex === index));
    for (let i = 0; i < lane.pointCount; i++) {
      const x = lane.x(i);
      const z = lane.z(i);
      if (junctions.some((junction) => Math.hypot(junction.x - x, junction.z - z) < JUNCTION_REACH_METERS)) {
        continue;
      }
      for (let other = 0; other < index; other++) {
        if (grids[other]!.nearRoad(x, z, ROAD_CLEARANCE_METERS - 0.5)) {
          crowded.push(`${lane.id}[${i}] by ${grown.roads[other]!.id}`);
        }
      }
    }
  }
  return crowded;
}

/** How far (x, z) lies from a rectangle, meters: 0 inside it. */
function distanceToArea(area: RectangleDefinition, x: number, z: number): number {
  const heading = (area.headingDegrees * Math.PI) / 180;
  const along = (x - area.x) * Math.sin(heading) + (z - area.z) * Math.cos(heading);
  const across = (x - area.x) * Math.cos(heading) - (z - area.z) * Math.sin(heading);
  return Math.hypot(Math.max(0, Math.abs(along) - area.lengthMeters / 2), Math.max(0, Math.abs(across) - area.widthMeters / 2));
}

/** Points round a rectangle's rim, `spacing` meters apart at most, and its middle. */
function rimAndMiddle(area: RectangleDefinition, spacing: number): Point2[] {
  const corners = rectangleCorners(area);
  const points: Point2[] = [[area.x, area.z]];
  corners.forEach(([ax, az], index) => {
    const [bx, bz] = corners[(index + 1) % corners.length]!;
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / spacing);
    for (let step = 0; step < steps; step++) {
      points.push([ax + ((bx - ax) * step) / steps, az + ((bz - az) * step) / steps]);
    }
  });
  return points;
}

/** A rectangle's reach from its middle: its half diagonal. */
function reachOf(area: RectangleDefinition): number {
  return Math.hypot(area.lengthMeters, area.widthMeters) / 2;
}

interface Box {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function boxArea(box: Box): RectangleDefinition {
  return {
    x: (box.minX + box.maxX) / 2,
    z: (box.minZ + box.maxZ) / 2,
    headingDegrees: 0,
    lengthMeters: box.maxZ - box.minZ,
    widthMeters: box.maxX - box.minX,
  };
}

function boxDistance(box: Box, x: number, z: number): number {
  return Math.hypot(x - Math.max(box.minX, Math.min(x, box.maxX)), z - Math.max(box.minZ, Math.min(z, box.maxZ)));
}

/** The gap between two boxes square to the map: the larger of their gaps along x and along z (negative where they overlap). */
function boxGap(a: Box, b: Box): number {
  return Math.max(a.minX - b.maxX, b.minX - a.maxX, a.minZ - b.maxZ, b.minZ - a.maxZ);
}

describe.each([
  { name: 'a small country', world: countryWorld, map: countryMap },
  { name: `the ${region.id} region`, world: regionWorld, map: region },
])('the side roads of $name', ({ world, map }) => {
  const lanes = lanesOf(world);

  it("grows narrow lanes after the map's roads, numbered as they grew, none of them short", () => {
    expect(lanes.length).toBeGreaterThan(10);
    expect(lanes.every(({ index }) => index >= world.mapRoadCount)).toBe(true);
    expect(map.roads.some((road) => road.kind === 'lane')).toBe(false);
    expect(lanes.map(({ lane }) => lane.id)).toEqual(lanes.map((_, n) => `lane_${n + 1}`));
    for (const { lane } of lanes) {
      expect(lane.widthMeters, lane.id).toBe(LANE_WIDTH_METERS);
      expect(lane.closed, lane.id).toBe(false);
      expect(lane.lengthMeters, lane.id).toBeGreaterThanOrEqual(120);
    }
  });

  it('leaves a country road or another lane at a T-junction: exactly on one of its samples, square to it', () => {
    expect(misplacedStarts(world)).toEqual([]);
  });

  it('ends where it joins another road exactly on one of its samples, or else in a turning circle', () => {
    const { misplaced, joins } = misplacedEnds(world);
    const circled = world.turningCircles.filter(({ roadIndex }) => world.roads[roadIndex]!.kind === 'lane');

    expect(misplaced).toEqual([]);
    expect(joins).toBeGreaterThan(0);
    expect(joins).toBeLessThan(lanes.length);
    expect(circled).toHaveLength(lanes.length - joins);
    for (const circle of circled) {
      const lane = world.roads[circle.roadIndex]!;
      expect(circle.sampleIndex).toBe(lane.pointCount - 1);
      expect(Math.hypot(circle.x - lane.x(circle.sampleIndex), circle.z - lane.z(circle.sampleIndex))).toBeCloseTo(2, 9);
    }
  });

  it('keeps 38 m from the edge of every road there before it, but within 60 m of where it meets one', () => {
    expect(crowdedSamples(world)).toEqual([]);
  });

  it('leaves and joins the roads 140 m and more from any other junction', () => {
    const roads = world.roads;
    const laneTees = world.network.junctions.filter(
      (junction) =>
        junction.members.some(({ roadIndex, sampleIndex }) => sampleIndex > 0 && sampleIndex < roads[roadIndex]!.pointCount - 1) &&
        junction.members.some(({ roadIndex }) => roads[roadIndex]!.kind === 'lane'),
    );
    const tooNear: string[] = [];
    expect(laneTees.length).toBeGreaterThan(lanes.length / 2);
    for (const tee of laneTees) {
      for (const other of world.network.junctions) {
        if (other !== tee && Math.hypot(other.x - tee.x, other.z - tee.z) < 140 - 1) {
          tooNear.push(`${tee.members.map(({ roadIndex }) => roads[roadIndex]!.id).join(' and ')} by another junction`);
        }
      }
    }
    expect(tooNear).toEqual([]);
  });

  it('stays well inside the map, its turning circles too', () => {
    const limit = map.halfSizeMeters - 50;
    const outside: string[] = [];
    for (const { lane } of lanes) {
      for (let i = 0; i < lane.pointCount; i++) {
        if (Math.max(Math.abs(lane.x(i)), Math.abs(lane.z(i))) > limit) {
          outside.push(`${lane.id}[${i}]`);
        }
      }
    }
    for (const circle of world.turningCircles.filter(({ roadIndex }) => world.roads[roadIndex]!.kind === 'lane')) {
      if (Math.max(Math.abs(circle.x), Math.abs(circle.z)) + circle.radiusMeters > limit) {
        outside.push(`the turning circle of ${world.roads[circle.roadIndex]!.id}`);
      }
    }
    expect(outside).toEqual([]);
  });

  it('keeps off the water, out of the woods, and clear of the parks, yards, fields, buildings, turbines and name boards', () => {
    const halfWidth = LANE_WIDTH_METERS / 2;
    const mapParks = world.parks.slice(0, (map.parks ?? []).length);
    const greens = world.parks.slice((map.parks ?? []).length);
    const mapFields = world.fields.slice(0, map.fields.length);
    const grownFields = world.fields.slice(map.fields.length);
    const yards = [...map.depots.map((depot) => depot.yard), ...map.restAreas.map((restArea) => restArea.lot)];
    const mapBuildings = world.buildings.filter((building) => building.country !== true);
    const grownBuildings = world.buildings.filter((building) => building.country === true);
    const inTheWay: string[] = [];
    for (const { lane } of lanes) {
      for (let i = 0; i < lane.pointCount; i++) {
        const x = lane.x(i);
        const z = lane.z(i);
        const at = `${lane.id}[${i}]`;
        if (world.isWater(x, z, 27.5)) {
          inTheWay.push(`${at} by the water`);
        }
        for (const forest of world.forests) {
          if (forestContains(forest, x, z) || distanceToForestEdge(forest, x, z) < 11.5) {
            inTheWay.push(`${at} by ${forest.id}`);
          }
        }
        // The villages' greens and houses grew before the lanes; the farms and their fields after them.
        for (const park of mapParks) {
          if (rectangleContains(park.area, x, z, 39.5)) {
            inTheWay.push(`${at} by ${park.id}`);
          }
        }
        for (const park of greens) {
          if (rectangleContains(park.area, x, z, 29.5)) {
            inTheWay.push(`${at} by ${park.id}`);
          }
        }
        for (const yard of yards) {
          if (rectangleContains(yard, x, z, 39.5)) {
            inTheWay.push(`${at} by a yard`);
          }
        }
        for (const field of mapFields) {
          if (rectangleContains(field.area, x, z, 11.5)) {
            inTheWay.push(`${at} by one of the map's fields`);
          }
        }
        for (const field of grownFields) {
          if (distanceToArea(field.area, x, z) - halfWidth < 9) {
            inTheWay.push(`${at} by a grown field`);
          }
        }
        for (const building of mapBuildings) {
          if (boxDistance(building, x, z) < 17.5) {
            inTheWay.push(`${at} by one of the map's buildings`);
          }
        }
        for (const building of grownBuildings) {
          if (boxDistance(building, x, z) - halfWidth < 6) {
            inTheWay.push(`${at} by a grown building`);
          }
        }
        for (const turbine of world.windTurbines) {
          if (Math.hypot(x - turbine.x, z - turbine.z) < 74.5) {
            inTheWay.push(`${at} by a wind turbine`);
          }
        }
        for (const sign of world.citySigns) {
          if (Math.hypot(x - sign.x, z - sign.z) < 44.5) {
            inTheWay.push(`${at} by ${sign.cityId}'s name board`);
          }
        }
      }
    }
    expect(inTheWay).toEqual([]);
  });

  it("stands the country's buildings 6.5 m off every road's edge, 5 m off the turning circles and apart", () => {
    const grown = world.buildings.filter((building) => building.country === true);
    const mapBuildings = world.buildings.filter((building) => building.country !== true);
    const nearRoads = new RoadGrid(world.roads, 6.5);
    const misplaced: string[] = [];
    expect(grown.length).toBeGreaterThan(10);
    grown.forEach((building, index) => {
      const name = `the building at ${Math.round((building.minX + building.maxX) / 2)}, ${Math.round((building.minZ + building.maxZ) / 2)}`;
      // The roads' samples lie a few metres apart: between two of them, a road comes a little nearer.
      if (rimAndMiddle(boxArea(building), 0.5).some(([x, z]) => nearRoads.nearRoad(x, z, 6.2))) {
        misplaced.push(`${name} by a road`);
      }
      for (const circle of world.turningCircles) {
        if (boxDistance(building, circle.x, circle.z) < circle.radiusMeters + 5 - 1e-6) {
          misplaced.push(`${name} by the turning circle of ${world.roads[circle.roadIndex]!.id}`);
        }
      }
      for (const other of grown.slice(index + 1)) {
        if (boxGap(building, other) < 4 - 1e-6) {
          misplaced.push(`${name} by another`);
        }
      }
      for (const other of mapBuildings) {
        if (boxGap(building, other) < 4.9) {
          misplaced.push(`${name} by one of the map's`);
        }
      }
    });
    expect(misplaced).toEqual([]);
  });

  it("lays the country's fields 9.5 m off every road's edge, 6 m off the buildings and 4 m apart", () => {
    const grownFields = world.fields.slice(map.fields.length);
    const nearRoads = new RoadGrid(world.roads, 9.5);
    const misplaced: string[] = [];
    expect(grownFields.length).toBeGreaterThan(3);
    for (const field of grownFields) {
      const name = `the field at ${Math.round(field.area.x)}, ${Math.round(field.area.z)}`;
      const reach = reachOf(field.area);
      const rim = rimAndMiddle(field.area, 1);
      if (rim.some(([x, z]) => nearRoads.nearRoad(x, z, 9))) {
        misplaced.push(`${name} by a road`);
      }
      for (const building of world.buildings) {
        if (boxDistance(building, field.area.x, field.area.z) > reach + 6) {
          continue;
        }
        if (rim.some(([x, z]) => boxDistance(building, x, z) < 5.8)) {
          misplaced.push(`${name} by a building`);
        }
      }
      for (const other of world.fields) {
        if (other === field || Math.hypot(other.area.x - field.area.x, other.area.z - field.area.z) > reach + reachOf(other.area) + 4) {
          continue;
        }
        if (rim.some(([x, z]) => distanceToArea(other.area, x, z) < 3.8)) {
          misplaced.push(`${name} by another`);
        }
      }
    }
    expect(misplaced).toEqual([]);
  });
});

describe('growSideRoads', () => {
  const country = countryOf(countryWorld, countryMap);
  const regionCountry = countryOf(regionWorld, region);

  function grow(from: Country, seed: number, perKilometer: number): CountryPlan {
    const plan = new CountryPlan(from.land, from.mapRoads);
    growSideRoads(plan, seed, perKilometer);
    return plan;
  }

  function grownOf(plan: CountryPlan): Grown {
    return { roads: plan.roads, mapRoadCount: plan.mapRoadCount, network: new RoadNetwork(plan.roads) };
  }

  /** What grew, to compare: each new road's id and samples, the buildings and the turning circles. */
  function growth(plan: CountryPlan): unknown {
    return {
      roads: plan.newRoads.map((road) => ({ id: road.id, points: Array.from(road.points) })),
      buildings: plan.buildings,
      circles: plan.circles,
    };
  }

  it('grows nothing at no lanes a kilometre', () => {
    for (const from of [country, regionCountry]) {
      const plan = grow(from, 5, 0);
      expect(plan.newRoads).toEqual([]);
      expect(plan.buildings).toEqual([]);
      expect(plan.circles).toEqual([]);
    }
  });

  it('grows the same lanes, farms and hamlets from the same seed, and others from another', () => {
    for (const from of [country, regionCountry]) {
      const once = growth(grow(from, 11, 2));
      expect(growth(grow(from, 11, 2))).toEqual(once);
      expect(growth(grow(from, 12, 2))).not.toEqual(once);
    }
  });

  it('keeps to its junctions, dead ends and clearances whatever the seed', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const grown = grownOf(grow(country, seed, 5));
      expect(lanesOf(grown).length, `seed ${seed}`).toBeGreaterThan(5);
      expect(misplacedStarts(grown), `seed ${seed}`).toEqual([]);
      expect(misplacedEnds(grown).misplaced, `seed ${seed}`).toEqual([]);
      expect(crowdedSamples(grown), `seed ${seed}`).toEqual([]);
      expect(grown.network.componentCount, `seed ${seed}`).toBe(1);
    }
  });

  it('grows more lanes the more a kilometre it is asked for', () => {
    const few = grow(country, 7, 1).newRoads.length;
    const many = grow(country, 7, 5).newRoads.length;

    expect(few).toBeGreaterThan(0);
    expect(many).toBeGreaterThan(few * 2);
  });

  it('grows lanes off the country roads only: not off the streets, ring roads, highways or country roads in a loop', () => {
    const road = (id: string, kind: RoadPath['kind'], closed: boolean, controlPoints: readonly Point2[]): RoadPath =>
      new RoadPath({ id, kind, widthMeters: 10, closed, controlPoints });
    const town = [
      road('main_street', 'street', false, [
        [-1300, -600],
        [1300, -600],
      ]),
      road('bypass', 'highway', false, [
        [-1300, 0],
        [1300, 0],
      ]),
      road('ring', 'ringRoad', true, [
        [-1000, 300],
        [1000, 300],
        [1000, 1300],
        [-1000, 1300],
      ]),
      road('loop', 'rural', true, [
        [-1300, -1300],
        [1300, -1300],
        [1300, -900],
        [-1300, -900],
      ]),
    ];
    const plan = new CountryPlan(emptyLand(1500), town);
    growSideRoads(plan, 3, 5);
    expect(plan.newRoads).toEqual([]);

    // The same bypass as a country road sprouts them.
    const country = new CountryPlan(emptyLand(1500), [...town.slice(0, 1), road('bypass', 'rural', false, [[-1300, 0], [1300, 0]]), ...town.slice(2)]);
    growSideRoads(country, 3, 5);
    expect(country.newRoads.length).toBeGreaterThan(0);
  });

  it('ends every lane that joins nothing in a turning circle, and keeps the farms off it', () => {
    const plan = grow(regionCountry, 4, 3);
    const network = new RoadNetwork(plan.roads);
    const deadEnds = network.deadEnds.filter(({ roadIndex }) => roadIndex >= plan.mapRoadCount);

    expect(deadEnds.length).toBeGreaterThan(0);
    expect(deadEnds.every(({ roadIndex, sampleIndex }) => sampleIndex === plan.roads[roadIndex]!.pointCount - 1)).toBe(true);
    expect(plan.circles).toHaveLength(deadEnds.length);
    expect(plan.buildings.length).toBeGreaterThan(10);
    for (const [x, z] of plan.circles) {
      for (const building of plan.buildings) {
        const walls = {
          minX: building.x - building.widthMeters / 2,
          maxX: building.x + building.widthMeters / 2,
          minZ: building.z - building.depthMeters / 2,
          maxZ: building.z + building.depthMeters / 2,
        };
        expect(boxDistance(walls, x, z)).toBeGreaterThanOrEqual(TURNING_CIRCLE_RADIUS_METERS + 5 - 1e-6);
      }
    }
    expect(network.componentCount).toBe(1);
  });
});

describe('layFarmland', () => {
  const country = countryOf(countryWorld, countryMap);

  function farmed(seed: number): CountryPlan {
    const plan = new CountryPlan(country.land, country.mapRoads);
    growSideRoads(plan, 5, 4);
    layFarmland(plan, seed);
    return plan;
  }

  it("lays fields beside the new roads, as fieldArea places them: clear of every road's edge, the buildings and each other", () => {
    const plan = farmed(1);
    const byId = new Map(plan.roads.map((road, index) => [road.id, { road, index }]));
    const nearRoads = new RoadGrid(plan.roads, 9.5);
    const areas = plan.fields.map((field) => fieldArea(byId.get(field.roadId)!.road, field));

    expect(plan.fields.length).toBeGreaterThan(5);
    for (const field of plan.fields) {
      const { road, index } = byId.get(field.roadId)!;
      expect(index).toBeGreaterThanOrEqual(plan.mapRoadCount);
      expect(road.kind).toBe('lane');
      expect(field.fromMeters).toBeGreaterThan(0);
      expect(field.fromMeters + field.lengthMeters).toBeLessThanOrEqual(road.lengthMeters - JUNCTION_REACH_METERS + 1e-9);
    }
    areas.forEach((area, index) => {
      const rim = rimAndMiddle(area, 1);
      expect(rim.some(([x, z]) => nearRoads.nearRoad(x, z, 9))).toBe(false);
      for (const other of areas.slice(index + 1)) {
        expect(rim.some(([x, z]) => distanceToArea(other, x, z) < 3.8)).toBe(false);
      }
      for (const building of plan.buildings) {
        const walls = {
          minX: building.x - building.widthMeters / 2,
          maxX: building.x + building.widthMeters / 2,
          minZ: building.z - building.depthMeters / 2,
          maxZ: building.z + building.depthMeters / 2,
        };
        expect(rim.some(([x, z]) => boxDistance(walls, x, z) < 5.8)).toBe(false);
      }
    });
  });

  it('lays the same fields from the same seed, and others from another', () => {
    const fields = farmed(1).fields;

    expect(farmed(1).fields).toEqual(fields);
    expect(farmed(2).fields).not.toEqual(fields);
  });

  it("lays none beside the map's own roads, nor beside a new street", () => {
    const plan = new CountryPlan(country.land, country.mapRoads);
    layFarmland(plan, 1);
    expect(plan.fields).toEqual([]);

    plan.addRoad(
      new RoadPath({
        id: 'new_street',
        kind: 'street',
        widthMeters: 9,
        closed: false,
        controlPoints: [
          [500, 600],
          [1200, 600],
        ],
      }),
    );
    layFarmland(plan, 1);
    expect(plan.fields).toEqual([]);
  });
});

describe('the side roads helpers', () => {
  const straight = new RoadPath({
    id: 'straight',
    kind: 'rural',
    widthMeters: 8,
    closed: false,
    controlPoints: [
      [0, 0],
      [40, 0],
      [80, 0],
      [100, 0],
    ],
  });

  it('finds the sample nearest a distance along a road, and its end ones beyond its ends', () => {
    expect(sampleAt(straight, 0)).toBe(0);
    expect(sampleAt(straight, -50)).toBe(0);
    expect(sampleAt(straight, 100)).toBe(straight.pointCount - 1);
    expect(sampleAt(straight, 500)).toBe(straight.pointCount - 1);
    for (let i = 0; i < straight.pointCount; i++) {
      expect(sampleAt(straight, straight.distances[i]!)).toBe(i);
    }
    for (let along = 0; along <= 100; along += 0.7) {
      const nearest = sampleAt(straight, along);
      const best = Math.min(...Array.from(straight.distances, (distance) => Math.abs(distance - along)));
      expect(Math.abs(straight.distances[nearest]! - along)).toBeCloseTo(best, 9);
    }
  });

  it("gives a road's direction at a sample from its neighbours, at its ends from the one beside them, round a loop across its seam", () => {
    const bend = new RoadPath({
      id: 'bend',
      kind: 'rural',
      widthMeters: 8,
      closed: false,
      controlPoints: [
        [0, 0],
        [100, 0],
        [100, 100],
      ],
    });
    const last = bend.pointCount - 1;
    const direction = (from: number, to: number): [number, number] => {
      const dx = bend.x(to) - bend.x(from);
      const dz = bend.z(to) - bend.z(from);
      return [dx / Math.hypot(dx, dz), dz / Math.hypot(dx, dz)];
    };

    for (const [i, from, to] of [
      [0, 0, 1],
      [1, 0, 2],
      [20, 19, 21],
      [last, last - 1, last],
    ] as const) {
      const [x, z] = tangentAt(bend, i);
      expect(x).toBeCloseTo(direction(from, to)[0], 12);
      expect(z).toBeCloseTo(direction(from, to)[1], 12);
    }
    // Along x as it sets out, along z as it ends, a unit vector all the way.
    expect(tangentAt(bend, 0)[0]).toBeGreaterThan(0.99);
    expect(tangentAt(bend, last)[1]).toBeGreaterThan(0.99);
    for (let i = 0; i <= last; i++) {
      const [x, z] = tangentAt(bend, i);
      expect(Math.hypot(x, z)).toBeCloseTo(1, 9);
    }
    // Along a straight road, its heading everywhere.
    const diagonal = new RoadPath({
      id: 'diagonal',
      kind: 'rural',
      widthMeters: 8,
      closed: false,
      controlPoints: [
        [0, 0],
        [30, 40],
        [60, 80],
      ],
    });
    for (let i = 0; i < diagonal.pointCount; i++) {
      expect(tangentAt(diagonal, i)[0]).toBeCloseTo(0.6, 9);
      expect(tangentAt(diagonal, i)[1]).toBeCloseTo(0.8, 9);
    }
    // Round a square loop, its first corner seen from the last sample and the second.
    const loop = new RoadPath({
      id: 'loop',
      kind: 'ringRoad',
      widthMeters: 8,
      closed: true,
      controlPoints: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
    });
    const [x, z] = tangentAt(loop, 0);
    expect(x).toBeGreaterThan(0.5);
    expect(z).toBeLessThan(-0.5);
  });

  it('counts the control points a road passes before one of its samples, the first at least', () => {
    const points: Point2[] = [
      [0, 0],
      [40, 0],
      [80, 30],
      [120, 30],
    ];
    const road = new RoadPath({ id: 'road', kind: 'lane', widthMeters: 5.5, closed: false, controlPoints: points });
    // Every control point is one of the samples, exactly.
    const sampleOf = (point: Point2): number => {
      for (let i = 0; i < road.pointCount; i++) {
        if (road.x(i) === point[0] && road.z(i) === point[1]) {
          return i;
        }
      }
      return -1;
    };
    const [first, second, third, fourth] = points.map(sampleOf);

    expect(first).toBe(0);
    expect(fourth).toBe(road.pointCount - 1);
    expect(second).toBeGreaterThan(0);
    expect(third).toBeGreaterThan(second!);
    expect(controlPointsBefore(road, points, 0)).toBe(1);
    expect(controlPointsBefore(road, points, 1)).toBe(1);
    expect(controlPointsBefore(road, points, second!)).toBe(1);
    expect(controlPointsBefore(road, points, second! + 1)).toBe(2);
    expect(controlPointsBefore(road, points, third!)).toBe(2);
    expect(controlPointsBefore(road, points, fourth!)).toBe(3);
  });

  it('turns from one heading to another the shorter way round, never more than half a turn', () => {
    expect(angleFrom(0, 1)).toBeCloseTo(1, 12);
    expect(angleFrom(1, 0)).toBeCloseTo(-1, 12);
    expect(angleFrom(0, (3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 12);
    expect(angleFrom(-3, 3)).toBeCloseTo(6 - 2 * Math.PI, 12);
    expect(angleFrom(Math.PI, -Math.PI)).toBeCloseTo(0, 12);
    expect(angleFrom(0.5, 0.5 + 9 * Math.PI + 0.25)).toBeCloseTo(0.25 - Math.PI, 9);
    for (let from = -7; from <= 7; from += 0.9) {
      for (let to = -7; to <= 7; to += 1.1) {
        const turn = angleFrom(from, to);
        expect(Math.abs(turn)).toBeLessThanOrEqual(Math.PI + 1e-12);
        expect(Math.cos(from + turn)).toBeCloseTo(Math.cos(to), 9);
        expect(Math.sin(from + turn)).toBeCloseTo(Math.sin(to), 9);
      }
    }
  });
});
