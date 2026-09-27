import { describe, expect, it } from 'vitest';
import type { FieldDefinition, ParkDefinition, Point2, RectangleDefinition } from '../../../../src/data/definitions/MapDefinition';
import {
  alongRim,
  CountryPlan,
  JUNCTION_REACH_METERS,
  ROAD_CLEARANCE_METERS,
  type CountryLand,
} from '../../../../src/domain/world/countryPlan';
import { TURNING_CIRCLE_OFFSET_METERS, TURNING_CIRCLE_RADIUS_METERS } from '../../../../src/domain/world/RoadNetwork';
import { RoadPath } from '../../../../src/domain/world/RoadPath';

/** Land open to everything on a 2 km map, but where `overrides` say otherwise. */
function openCountry(overrides: Partial<CountryLand> = {}): CountryLand {
  return {
    halfSizeMeters: 1000,
    isOpenForRoad: () => true,
    canJoinAt: () => true,
    isOpenForBuilding: () => true,
    isOpenForField: () => true,
    ...overrides,
  };
}

/** The map's country road: 8 m wide along the x axis, from x = -800 to 800. Its edges are at z = ±4. */
function countryRoad(): RoadPath {
  return new RoadPath({
    id: 'country_road',
    kind: 'rural',
    widthMeters: 8,
    closed: false,
    controlPoints: [
      [-800, 0],
      [800, 0],
    ],
  });
}

/** A new lane, 5.5 m wide, through `points`. */
function lane(id: string, points: readonly Point2[]): RoadPath {
  return new RoadPath({ id, kind: 'lane', widthMeters: 5.5, closed: false, controlPoints: points });
}

/** A rectangle square to the map: `sizeX` across x, `sizeZ` along z, its middle at (x, z). */
function box(x: number, z: number, sizeX: number, sizeZ: number): RectangleDefinition {
  return { x, z, headingDegrees: 0, lengthMeters: sizeZ, widthMeters: sizeX };
}

const WHEAT: FieldDefinition = {
  roadId: 'country_road',
  fromMeters: 0,
  lengthMeters: 100,
  side: 'right',
  setbackMeters: 10,
  depthMeters: 60,
  crop: 'wheat',
};

function green(id: string, area: RectangleDefinition): ParkDefinition {
  return { id, area };
}

describe('CountryPlan', () => {
  describe('its roads', () => {
    it("starts from the map's roads, and adds the new ones after them", () => {
      const road = countryRoad();
      const plan = new CountryPlan(openCountry(), [road]);
      const first = lane('lane_1', [
        [0, 0],
        [0, 300],
      ]);
      const second = lane('lane_2', [
        [300, 0],
        [300, -300],
      ]);

      expect(plan.mapRoadCount).toBe(1);
      expect(plan.roads).toHaveLength(1);
      expect(plan.roads[0]).toBe(road);
      expect(plan.newRoads).toEqual([]);
      expect(plan.addRoad(first)).toBe(1);
      expect(plan.addRoad(second)).toBe(2);
      expect(plan.roads).toHaveLength(3);
      expect(plan.roads[2]).toBe(second);
      expect(plan.newRoads).toHaveLength(2);
      expect(plan.newRoads[0]).toBe(first);
      expect(plan.newRoads[1]).toBe(second);
    });

    it("keeps a new road 38 m from any other road's edge, past its ends too", () => {
      const plan = new CountryPlan(openCountry(), [countryRoad()]);

      expect(ROAD_CLEARANCE_METERS).toBe(38);
      expect(plan.isClearForRoad(0, 4 + ROAD_CLEARANCE_METERS - 0.5)).toBe(false);
      expect(plan.isClearForRoad(0, 4 + ROAD_CLEARANCE_METERS + 0.5)).toBe(true);
      expect(plan.isClearForRoad(250, -(4 + ROAD_CLEARANCE_METERS + 0.5))).toBe(true);
      expect(plan.isClearForRoad(800 + 4 + 37, 0)).toBe(false);
      expect(plan.isClearForRoad(800 + 4 + 39, 0)).toBe(true);
    });

    it('lets a new road near others within 60 m of where it meets them, at either end', () => {
      const plan = new CountryPlan(openCountry(), [countryRoad()]);

      expect(JUNCTION_REACH_METERS).toBe(60);
      expect(plan.isClearForRoad(0, 10)).toBe(false);
      expect(plan.isClearForRoad(0, 10, 0, 0)).toBe(true);
      expect(plan.isClearForRoad(0, 10, Number.NaN, Number.NaN, 0, 0)).toBe(true);
      expect(plan.isClearForRoad(59, 5, 0, 0)).toBe(true);
      expect(plan.isClearForRoad(61, 5, 0, 0)).toBe(false);
      expect(plan.isClearForRoad(-100, 5, 0, 0, 100, 0)).toBe(false);
    });

    it('keeps new roads as far from each other, by their own widths', () => {
      const plan = new CountryPlan(openCountry(), [countryRoad()]);
      plan.addRoad(
        lane('lane_1', [
          [0, 300],
          [0, 600],
        ]),
      );

      // The lane's edge is 2.75 m from its middle, x = 0.
      expect(plan.isClearForRoad(2.75 + ROAD_CLEARANCE_METERS - 0.5, 450)).toBe(false);
      expect(plan.isClearForRoad(2.75 + ROAD_CLEARANCE_METERS + 0.5, 450)).toBe(true);
      expect(plan.isClearForRoad(10, 450, 0, 450)).toBe(true);
    });

    it('asks the land first, even where a road meets another; the router has asked it already', () => {
      const plan = new CountryPlan(openCountry({ isOpenForRoad: (x) => x < 500 }), [countryRoad()]);

      expect(plan.isClearForRoad(600, 100)).toBe(false);
      expect(plan.isClearForRoad(600, 10, 600, 0)).toBe(false);
      expect(plan.isClearSinceLand(600, 100)).toBe(true);
      expect(plan.isClearSinceLand(600, 10)).toBe(false);
      expect(plan.isClearSinceLand(600, 10, 600, 0)).toBe(true);
    });

    it('looks along a straight run every 5 m, past its start', () => {
      const pond = (x: number, z: number): boolean => Math.hypot(x, z - 100) < 3;
      const plan = new CountryPlan(openCountry({ isOpenForRoad: (x, z) => !pond(x, z) }), [countryRoad()]);

      // Out of the pond, north: its start is not looked at.
      expect(plan.isClearRun(0, 100, 0, 300)).toBe(true);
      expect(plan.isClearRun(0, 300, 0, 60)).toBe(false);
      expect(plan.isClearRun(20, 300, 20, 60)).toBe(true);
      // Down to the road: only where it meets it.
      expect(plan.isClearRun(20, 300, 20, 0)).toBe(false);
      expect(plan.isClearRun(20, 300, 20, 0, 20, 0)).toBe(true);
      expect(plan.isClearRun(20, 0, 20, 300, Number.NaN, Number.NaN, 20, 0)).toBe(true);
    });

    it('finds the first sample of a road, past its first, that may not be there', () => {
      const plan = new CountryPlan(openCountry(), [countryRoad()]);
      const north = lane('north', [
        [0, 0],
        [0, 300],
      ]);

      expect(plan.firstBlockedSample(north, 0, 0)).toBe(-1);
      expect(plan.firstBlockedSample(north)).toBe(1);
      // A building in its way: its walls 195 m out, and roads keep 18 m from them.
      expect(plan.tryBuilding(0, 200, 10, 10, 5)).toBe(true);
      const blocked = plan.firstBlockedSample(north, 0, 0);
      expect(blocked).toBeGreaterThan(0);
      expect(north.z(blocked)).toBeGreaterThan(195 - 18);
      expect(north.z(blocked - 1)).toBeLessThanOrEqual(195 - 18);
    });

    it('lets a new road meet another only 140 m and more from any third road', () => {
      const plan = new CountryPlan(openCountry(), [
        countryRoad(),
        new RoadPath({
          id: 'other_road',
          kind: 'rural',
          widthMeters: 8,
          closed: false,
          controlPoints: [
            [500, 100],
            [500, 800],
          ],
        }),
      ]);

      expect(plan.canJunction(0, 0, 0)).toBe(true);
      // 137 m and 176 m from the other road's edge, at its end (500, 100).
      expect(plan.canJunction(400, 0, 0)).toBe(false);
      expect(plan.canJunction(350, 0, 0)).toBe(true);
      expect(plan.canJunction(500, 300, 1)).toBe(true);
      expect(plan.canJunction(500, 120, 1)).toBe(false);
    });

    it('lets a new road meet another away from the new roads but the one it meets', () => {
      const plan = new CountryPlan(openCountry(), [countryRoad()]);
      const laneIndex = plan.addRoad(
        lane('lane_1', [
          [0, 0],
          [0, 400],
        ]),
      );

      expect(plan.canJunction(100, 0, 0)).toBe(false);
      expect(plan.canJunction(200, 0, 0)).toBe(true);
      expect(plan.canJunction(0, 300, laneIndex)).toBe(true);
      expect(plan.canJunction(0, 100, laneIndex)).toBe(false);
    });

    it('lets roads meet only where the land lets them meet and pass, clear of what has grown', () => {
      const plan = new CountryPlan(openCountry({ canJoinAt: (x) => x < 100, isOpenForRoad: (x) => x > -100 }), [countryRoad()]);

      expect(plan.canJunction(0, 0, 0)).toBe(true);
      expect(plan.canJunction(200, 0, 0)).toBe(false);
      expect(plan.canJunction(-200, 0, 0)).toBe(false);
      // A house 11 m off the road's edge: 15 m from where a lane would leave.
      expect(plan.tryBuilding(30, 20, 10, 10, 5)).toBe(true);
      expect(plan.canJunction(30, 0, 0)).toBe(false);
      expect(plan.canJunction(-60, 0, 0)).toBe(true);
    });

    it('notes a turning circle just past the end of a road that joins nothing, at either end', () => {
      const plan = new CountryPlan(openCountry(), [countryRoad()]);
      const deadEnd = lane('lane_1', [
        [0, 100],
        [0, 300],
      ]);
      plan.addTurningCircle(deadEnd, false);
      plan.addTurningCircle(deadEnd, true);

      expect(plan.circles).toHaveLength(2);
      expect(plan.circles[0]![0]).toBeCloseTo(0, 9);
      expect(plan.circles[0]![1]).toBeCloseTo(300 + TURNING_CIRCLE_OFFSET_METERS, 9);
      expect(plan.circles[1]![0]).toBeCloseTo(0, 9);
      expect(plan.circles[1]![1]).toBeCloseTo(100 - TURNING_CIRCLE_OFFSET_METERS, 9);
    });

    it('finds ways for new roads over the open land', () => {
      const wood = (x: number, z: number): boolean => Math.abs(x) < 100 && z > 100 && z < 900;
      const plan = new CountryPlan(openCountry({ isOpenForRoad: (x, z) => !wood(x, z) }), [countryRoad()]);
      const way = plan.router.route(-300, 500, 300, 500, (x, z) => plan.isClearSinceLand(x, z))!;

      expect(way).not.toBeNull();
      expect(way.filter(([x, z]) => wood(x, z))).toEqual([]);
    });
  });

  describe('its buildings', () => {
    it("stands a building on open land 6.5 m and more from a road's edge and 4 m from the others", () => {
      const plan = new CountryPlan(openCountry(), [countryRoad()]);

      // Walls 6 m and 7 m from the road's edge.
      expect(plan.tryBuilding(0, 4 + 6 + 5, 10, 10, 6)).toBe(false);
      expect(plan.tryBuilding(0, 4 + 7 + 5, 10, 10, 6)).toBe(true);
      expect(plan.buildings).toEqual([{ x: 0, z: 16, widthMeters: 10, depthMeters: 10, heightMeters: 6 }]);
      // 3.5 m and 4.5 m from its walls.
      expect(plan.tryBuilding(5 + 3.5 + 4, 16, 8, 10, 5)).toBe(false);
      expect(plan.tryBuilding(5 + 4.5 + 4, 16, 8, 10, 5)).toBe(true);
      expect(plan.tryBuilding(0, 16, 4, 4, 5)).toBe(false);
      expect(plan.buildings).toHaveLength(2);
    });

    it("stands a building 6.5 m and more from a new road's edge", () => {
      const plan = new CountryPlan(openCountry(), [countryRoad()]);
      plan.addRoad(
        lane('lane_1', [
          [-300, 100],
          [-300, 500],
        ]),
      );

      // Walls 6 m and 8 m from the lane's edge, x = -297.25.
      expect(plan.tryBuilding(-297.25 + 6 + 5, 300, 10, 10, 5)).toBe(false);
      expect(plan.tryBuilding(-297.25 + 8 + 5, 300, 10, 10, 5)).toBe(true);
      expect(plan.tryBuilding(-302.75 - 8 - 5, 300, 10, 10, 5)).toBe(true);
    });

    it('keeps a building 5 m off the turning circles, 4 m off the parks and 6 m off the fields', () => {
      const plan = new CountryPlan(openCountry(), [countryRoad()]);
      plan.addTurningCircle(
        lane('lane_1', [
          [0, 100],
          [0, 300],
        ]),
        false,
      );
      expect(plan.tryPark(green('test_green', box(400, 300, 60, 60)))).toBe(true);
      expect(plan.tryField(WHEAT, box(-400, 300, 100, 100))).toBe(true);

      // The circle's rim is 313 m out: walls 4 m and 6 m past it.
      expect(plan.tryBuilding(0, 313 + 4 + 5, 10, 10, 5)).toBe(false);
      expect(plan.tryBuilding(0, 313 + 6 + 5, 10, 10, 5)).toBe(true);
      // The park reaches x = 430: walls 3 m and 5 m past it.
      expect(plan.tryBuilding(430 + 3 + 5, 300, 10, 10, 5)).toBe(false);
      expect(plan.tryBuilding(430 + 5 + 5, 300, 10, 10, 5)).toBe(true);
      // The field reaches x = -350: walls 5 m and 7 m past it.
      expect(plan.tryBuilding(-350 + 5 + 5, 300, 10, 10, 5)).toBe(false);
      expect(plan.tryBuilding(-350 + 7 + 5, 300, 10, 10, 5)).toBe(true);
      expect(plan.buildings).toHaveLength(3);
      expect(TURNING_CIRCLE_RADIUS_METERS).toBe(11);
    });

    it('stands no building where the land holds something already', () => {
      const plan = new CountryPlan(openCountry({ isOpenForBuilding: (area) => area.x > 0 }), [countryRoad()]);

      expect(plan.tryBuilding(-100, 100, 10, 10, 5)).toBe(false);
      expect(plan.tryBuilding(100, 100, 10, 10, 5)).toBe(true);
      expect(plan.buildings).toEqual([{ x: 100, z: 100, widthMeters: 10, depthMeters: 10, heightMeters: 5 }]);
    });

    it('keeps the new roads 18 m from the buildings grown before them, even where they meet a road', () => {
      const plan = new CountryPlan(openCountry(), [countryRoad()]);
      expect(plan.tryBuilding(0, 300, 10, 10, 5)).toBe(true);

      // Its walls reach z = 305.
      expect(plan.isClearForRoad(0, 305 + 17)).toBe(false);
      expect(plan.isClearForRoad(0, 305 + 19)).toBe(true);
      expect(plan.isClearForRoad(0, 305 + 17, 0, 305 + 40)).toBe(false);
      expect(plan.canJunction(0, 305 + 17, 0)).toBe(false);
    });
  });

  describe('its fields', () => {
    it("lays a field on open land 9.5 m and more from a road's edge and 4 m from the other fields", () => {
      const plan = new CountryPlan(openCountry(), [countryRoad()]);

      // 9 m and 10 m from the road's edge.
      expect(plan.tryField(WHEAT, box(0, 4 + 9 + 30, 100, 60))).toBe(false);
      expect(plan.tryField(WHEAT, box(0, 4 + 10 + 30, 100, 60))).toBe(true);
      expect(plan.fields).toEqual([WHEAT]);
      // 3 m and 5 m beside it, and one over it.
      expect(plan.tryField(WHEAT, box(50 + 3 + 50, 44, 100, 60))).toBe(false);
      expect(plan.tryField(WHEAT, box(50 + 5 + 50, 44, 100, 60))).toBe(true);
      expect(plan.tryField(WHEAT, { x: 0, z: 44, headingDegrees: 45, lengthMeters: 20, widthMeters: 20 })).toBe(false);
      expect(plan.fields).toHaveLength(2);
    });

    it('keeps a field 10 m off the new roads, clear of the turning circles, 6 m off the buildings and 4 m off the parks', () => {
      const plan = new CountryPlan(openCountry(), [countryRoad()]);
      plan.addRoad(
        lane('lane_1', [
          [-500, 100],
          [-500, 700],
        ]),
      );
      plan.addTurningCircle(
        lane('lane_2', [
          [0, 100],
          [0, 300],
        ]),
        false,
      );
      expect(plan.tryBuilding(500, 300, 10, 10, 5)).toBe(true);
      expect(plan.tryPark(green('test_green', box(500, 600, 60, 60)))).toBe(true);

      // 9 m and 11 m from the lane's edge, x = -497.25.
      expect(plan.tryField(WHEAT, box(-497.25 + 9 + 50, 400, 100, 60))).toBe(false);
      expect(plan.tryField(WHEAT, box(-497.25 + 11 + 50, 400, 100, 60))).toBe(true);
      // 20 m and 22 m from the circle's middle, (0, 302).
      expect(plan.tryField(WHEAT, box(0, 302 + 20 + 30, 100, 60))).toBe(false);
      expect(plan.tryField(WHEAT, box(0, 302 + 22 + 30, 100, 60))).toBe(true);
      // 5 m and 7 m from the building's walls, x = 505.
      expect(plan.tryField(WHEAT, box(505 + 5 + 50, 300, 100, 60))).toBe(false);
      expect(plan.tryField(WHEAT, box(505 + 7 + 50, 300, 100, 60))).toBe(true);
      // 3 m and 5 m from the park, which reaches x = 530.
      expect(plan.tryField(WHEAT, box(530 + 3 + 50, 600, 100, 60))).toBe(false);
      expect(plan.tryField(WHEAT, box(530 + 5 + 50, 600, 100, 60))).toBe(true);
    });

    it('lays no field where the land holds something already', () => {
      const plan = new CountryPlan(openCountry({ isOpenForField: () => false }), [countryRoad()]);

      expect(plan.tryField(WHEAT, box(0, 300, 100, 60))).toBe(false);
      expect(plan.fields).toEqual([]);
    });

    it('keeps the new roads 12 m from the fields laid before them', () => {
      const plan = new CountryPlan(openCountry(), [countryRoad()]);
      expect(plan.tryField(WHEAT, box(0, 300, 100, 60))).toBe(true);

      // It reaches z = 330 and x = 50.
      expect(plan.isClearForRoad(0, 330 + 11)).toBe(false);
      expect(plan.isClearForRoad(0, 330 + 13)).toBe(true);
      expect(plan.isClearForRoad(50 + 11, 300)).toBe(false);
      expect(plan.isClearForRoad(50 + 13, 300)).toBe(true);
    });
  });

  describe('its parks', () => {
    it("lays out a village green 6 m and more from a road's edge, and keeps the new roads 30 m from it", () => {
      const plan = new CountryPlan(openCountry(), [countryRoad()]);
      const first = green('first_green', box(0, 4 + 5 + 30, 80, 60));
      const second = green('second_green', box(0, 4 + 7 + 30, 80, 60));

      expect(plan.tryPark(first)).toBe(false);
      expect(plan.tryPark(second)).toBe(true);
      expect(plan.parks).toEqual([second]);
      // It reaches z = 71.
      expect(plan.isClearForRoad(0, 71 + 29)).toBe(false);
      expect(plan.isClearForRoad(0, 71 + 31)).toBe(true);
    });

    it('keeps a green 4 m off the buildings, fields and other greens, and off the turning circles', () => {
      const plan = new CountryPlan(openCountry(), [countryRoad()]);
      expect(plan.tryBuilding(0, 300, 10, 10, 5)).toBe(true);
      expect(plan.tryField(WHEAT, box(300, 300, 100, 60))).toBe(true);
      plan.addTurningCircle(
        lane('lane_1', [
          [-300, 100],
          [-300, 300],
        ]),
        false,
      );

      // 3 m and 5 m from the building's walls, x = 5.
      expect(plan.tryPark(green('a', box(5 + 3 + 30, 300, 60, 60)))).toBe(false);
      expect(plan.tryPark(green('b', box(5 + 5 + 30, 300, 60, 60)))).toBe(true);
      // 3 m from the field (x = 250) and from that green (x = 70), then 5 m from the green.
      expect(plan.tryPark(green('c', box(250 - 3 - 30, 300, 60, 60)))).toBe(false);
      expect(plan.tryPark(green('d', box(70 + 3 + 30, 300, 60, 60)))).toBe(false);
      expect(plan.tryPark(green('e', box(70 + 5 + 30, 300, 60, 60)))).toBe(true);
      // 16 m and 18 m from the circle's middle, (-300, 302).
      expect(plan.tryPark(green('f', box(-300, 302 + 16 + 30, 60, 60)))).toBe(false);
      expect(plan.tryPark(green('g', box(-300, 302 + 18 + 30, 60, 60)))).toBe(true);
      expect(plan.parks.map((park) => park.id)).toEqual(['b', 'e', 'g']);
    });

    it('lays out no green where the land has no room for a building', () => {
      const plan = new CountryPlan(openCountry({ isOpenForBuilding: () => false }), [countryRoad()]);

      expect(plan.tryPark(green('test_green', box(0, 300, 60, 60)))).toBe(false);
      expect(plan.parks).toEqual([]);
    });
  });
});

describe('alongRim', () => {
  // 10 m along z, 4 m across x: corners at (±2, ±5).
  const area: RectangleDefinition = { x: 0, z: 0, headingDegrees: 0, lengthMeters: 10, widthMeters: 4 };

  it("looks round a rectangle's rim every 2 m or less, from each corner, never at its middle", () => {
    const looked: Point2[] = [];
    const answer = alongRim(area, (x, z) => {
      looked.push([x, z]);
      return true;
    });

    expect(answer).toBe(true);
    expect(looked).toHaveLength(2 + 5 + 2 + 5);
    for (const [x, z] of looked) {
      expect(Math.abs(Math.abs(x) - 2) < 1e-9 || Math.abs(Math.abs(z) - 5) < 1e-9, `${x}, ${z}`).toBe(true);
    }
    for (const [cx, cz] of [
      [2, 5],
      [-2, 5],
      [-2, -5],
      [2, -5],
    ] as const) {
      expect(looked.some(([x, z]) => Math.hypot(x - cx, z - cz) < 1e-9)).toBe(true);
    }
    expect(looked.some(([x, z]) => Math.hypot(x, z) < 1.9)).toBe(false);
  });

  it('fails where any point of the rim fails, looking no further', () => {
    let looks = 0;

    expect(
      alongRim(area, (x) => {
        looks++;
        return x > -1;
      }),
    ).toBe(false);
    expect(looks).toBeLessThan(14);
    expect(alongRim({ ...area, headingDegrees: 90 }, (x) => Math.abs(x) <= 5 + 1e-9)).toBe(true);
    expect(alongRim({ ...area, headingDegrees: 90 }, (x) => Math.abs(x) < 4.9)).toBe(false);
  });
});
