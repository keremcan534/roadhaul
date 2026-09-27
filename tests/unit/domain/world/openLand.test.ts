import { describe, expect, it } from 'vitest';
import type { RectangleDefinition } from '../../../../src/data/definitions/MapDefinition';
import { createForest } from '../../../../src/domain/world/forests';
import { OpenLand, type LandParts } from '../../../../src/domain/world/openLand';
import { RiverPath } from '../../../../src/domain/world/RiverPath';

/** A 2 km map holding only `parts`. */
function landWith(parts: Partial<LandParts> = {}): OpenLand {
  return new OpenLand({
    halfSizeMeters: 1000,
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
    ...parts,
  });
}

/** A square `side` meters across, square to the map, its middle at (x, z). */
function square(x: number, z: number, side: number): RectangleDefinition {
  return { x, z, headingDegrees: 0, lengthMeters: side, widthMeters: side };
}

describe('OpenLand', () => {
  it('leaves an empty map open to roads, junctions, buildings and fields', () => {
    const land = landWith();

    expect(land.halfSizeMeters).toBe(1000);
    expect(land.isOpenForRoad(0, 0)).toBe(true);
    expect(land.canJoinAt(0, 0)).toBe(true);
    expect(land.isOpenForBuilding(square(0, 0, 20))).toBe(true);
    expect(land.isOpenForField({ x: 0, z: 0, headingDegrees: 30, lengthMeters: 150, widthMeters: 90 })).toBe(true);
  });

  it("keeps what grows off the map's edge: a road's centreline 80 m in, buildings 20 m and fields 15 m", () => {
    const land = landWith();

    expect(land.isOpenForRoad(919, 0)).toBe(true);
    expect(land.isOpenForRoad(-919, 919)).toBe(true);
    expect(land.isOpenForRoad(921, 0)).toBe(false);
    expect(land.isOpenForRoad(0, -921)).toBe(false);
    // Their rims: 21 m and 19 m in.
    expect(land.isOpenForBuilding(square(974, 0, 10))).toBe(true);
    expect(land.isOpenForBuilding(square(976, 0, 10))).toBe(false);
    expect(land.isOpenForBuilding(square(0, -976, 10))).toBe(false);
    // 16 m and 14 m in.
    expect(land.isOpenForField(square(979, 0, 10))).toBe(true);
    expect(land.isOpenForField(square(981, 0, 10))).toBe(false);
  });

  it("keeps roads out of the sea and 50 m back from its shore, buildings and fields 20 m", () => {
    const land = landWith({
      shoreline: [
        [-600, -1000],
        [-600, 1000],
      ],
    });

    expect(land.isOpenForRoad(-549, 0)).toBe(true);
    expect(land.isOpenForRoad(-551, 0)).toBe(false);
    expect(land.isOpenForRoad(-700, 300)).toBe(false);
    // Rims 21 m and 19 m from the shore.
    expect(land.isOpenForBuilding(square(-574, 0, 10))).toBe(true);
    expect(land.isOpenForBuilding(square(-576, 0, 10))).toBe(false);
    expect(land.isOpenForField(square(-574, 0, 10))).toBe(true);
    expect(land.isOpenForField(square(-576, 0, 10))).toBe(false);
  });

  it("keeps roads 28 m beyond a river's banks, buildings 10 m and fields 6 m", () => {
    // 20 m of water and 7 m of bank either side: the channel reaches 17 m from the middle, x = 300.
    const land = landWith({
      rivers: [
        new RiverPath({
          id: 'test_river',
          widthMeters: 20,
          points: [
            [300, -1000],
            [300, 1000],
          ],
        }),
      ],
    });

    expect(land.isOpenForRoad(254, 0)).toBe(true);
    expect(land.isOpenForRoad(256, 0)).toBe(false);
    expect(land.isOpenForRoad(300, 0)).toBe(false);
    expect(land.isOpenForRoad(346, 500)).toBe(true);
    expect(land.isOpenForBuilding(square(267, 0, 10))).toBe(true);
    expect(land.isOpenForBuilding(square(269, 0, 10))).toBe(false);
    expect(land.isOpenForField(square(271, 0, 10))).toBe(true);
    expect(land.isOpenForField(square(273, 0, 10))).toBe(false);
  });

  it('keeps roads out of the woods and 12 m clear of their edge, buildings 6 m and fields 5 m', () => {
    const wood = createForest({
      id: 'test_wood',
      kind: 'pine',
      outline: [
        [-500, 200],
        [-300, 200],
        [-300, 400],
        [-500, 400],
      ],
    });
    const land = landWith({ forests: [wood] });

    expect(land.isOpenForRoad(-400, 300)).toBe(false);
    expect(land.isOpenForRoad(-289, 300)).toBe(false);
    expect(land.isOpenForRoad(-287, 300)).toBe(true);
    // Rims 7 m and 5 m from its east edge.
    expect(land.isOpenForBuilding(square(-288, 300, 10))).toBe(true);
    expect(land.isOpenForBuilding(square(-290, 300, 10))).toBe(false);
    // 6 m and 4 m.
    expect(land.isOpenForField(square(-289, 300, 10))).toBe(true);
    expect(land.isOpenForField(square(-291, 300, 10))).toBe(false);
    // Nor round the whole wood, where neither its rim nor its middle comes near the wood's edge.
    expect(land.isOpenForField({ x: -280, z: 300, headingDegrees: 0, lengthMeters: 300, widthMeters: 500 })).toBe(false);
    expect(land.isOpenForField({ x: -280, z: 300, headingDegrees: 0, lengthMeters: 300, widthMeters: 20 })).toBe(true);
  });

  it("keeps roads 40 m from the parks, 12 m from the fields and 40 m from the depots' yards and rest areas' lots", () => {
    const land = landWith({
      parks: [{ area: square(0, 500, 100) }],
      // 200 m along x, 80 m deep: x 400..600, z -40..40.
      fields: [{ area: { x: 500, z: 0, headingDegrees: 90, lengthMeters: 200, widthMeters: 80 } }],
      yards: [{ x: -500, z: -500, headingDegrees: 0, lengthMeters: 60, widthMeters: 40 }],
    });

    expect(land.isOpenForRoad(0, 411)).toBe(false);
    expect(land.isOpenForRoad(0, 409)).toBe(true);
    expect(land.isOpenForRoad(89, 500)).toBe(false);
    expect(land.isOpenForRoad(500, 51)).toBe(false);
    expect(land.isOpenForRoad(500, 53)).toBe(true);
    expect(land.isOpenForRoad(500, 0)).toBe(false);
    expect(land.isOpenForRoad(-500, -431)).toBe(false);
    expect(land.isOpenForRoad(-500, -429)).toBe(true);
  });

  it('keeps roads 18 m from the buildings, 75 m from the wind turbines and 45 m from the name boards', () => {
    const land = landWith({
      buildings: [{ minX: 100, maxX: 120, minZ: -300, maxZ: -280 }],
      windTurbines: [{ x: -300, z: -300 }],
      citySigns: [{ x: 300, z: 300 }],
    });

    expect(land.isOpenForRoad(110, -263)).toBe(false);
    expect(land.isOpenForRoad(110, -261)).toBe(true);
    // Off a corner, as the crow flies: 17 m and 18.4 m.
    expect(land.isOpenForRoad(132, -268)).toBe(false);
    expect(land.isOpenForRoad(133, -267)).toBe(true);
    expect(land.isOpenForRoad(-226, -300)).toBe(false);
    expect(land.isOpenForRoad(-224, -300)).toBe(true);
    expect(land.isOpenForRoad(300, 344)).toBe(false);
    expect(land.isOpenForRoad(300, 346)).toBe(true);
  });

  it('finds what stands in the way from beyond the cell it stands in, as far as it keeps anything off', () => {
    const land = landWith({
      windTurbines: [{ x: 95, z: 0 }],
      buildings: [{ minX: -299, maxX: -290, minZ: 0, maxZ: 10 }],
      citySigns: [{ x: 0, z: 598 }],
    });

    expect(land.isOpenForRoad(169, 0)).toBe(false);
    expect(land.isOpenForRoad(171, 0)).toBe(true);
    expect(land.isOpenForRoad(-273, 5)).toBe(false);
    expect(land.isOpenForRoad(-271, 5)).toBe(true);
    expect(land.isOpenForRoad(0, 642)).toBe(false);
    // A building's rim 89 m from the turbine, in the next cell.
    expect(land.isOpenForBuilding(square(189, 0, 10))).toBe(false);
    expect(land.isOpenForBuilding(square(191, 0, 10))).toBe(true);
  });

  it('lets roads meet only 110 m and more from a bridge, 70 m from a name board and 80 m from a yard or lot', () => {
    const land = landWith({
      bridges: [{ x: 0, z: 0 }],
      citySigns: [{ x: 500, z: 0 }],
      yards: [square(-500, 0, 40)],
    });

    expect(land.canJoinAt(109, 0)).toBe(false);
    expect(land.canJoinAt(0, -111)).toBe(true);
    expect(land.canJoinAt(500, 69)).toBe(false);
    expect(land.canJoinAt(500, 71)).toBe(true);
    // 79 m and 81 m from the lot's edge: a road may pass there, but not meet another.
    expect(land.canJoinAt(-401, 0)).toBe(false);
    expect(land.isOpenForRoad(-401, 0)).toBe(true);
    expect(land.canJoinAt(-399, 0)).toBe(true);
  });

  it('lets roads meet wherever they may pass the rest, by the turbines, the buildings and the woods', () => {
    const land = landWith({
      windTurbines: [{ x: 0, z: 0 }],
      buildings: [{ minX: 300, maxX: 320, minZ: 0, maxZ: 20 }],
    });

    expect(land.isOpenForRoad(10, 0)).toBe(false);
    expect(land.canJoinAt(10, 0)).toBe(true);
    expect(land.canJoinAt(310, 10)).toBe(true);
  });

  it('stands a building 90 m and more from the turbines, 15 m from the name boards and 5 m from the other buildings', () => {
    const land = landWith({
      windTurbines: [{ x: 0, z: 0 }],
      citySigns: [{ x: 500, z: 500 }],
      buildings: [{ minX: -510, maxX: -490, minZ: -505, maxZ: -495 }],
    });

    // Rims 95 m and 89 m from the tower.
    expect(land.isOpenForBuilding(square(0, 100, 10))).toBe(true);
    expect(land.isOpenForBuilding(square(0, 94, 10))).toBe(false);
    expect(land.isOpenForBuilding(square(500, 521, 10))).toBe(true);
    expect(land.isOpenForBuilding(square(500, 519, 10))).toBe(false);
    // Walls 6 m and 4 m from the building's, and one right round it.
    expect(land.isOpenForBuilding(square(-479, -500, 10))).toBe(true);
    expect(land.isOpenForBuilding(square(-481, -500, 10))).toBe(false);
    expect(land.isOpenForBuilding(square(-500, -500, 60))).toBe(false);
  });

  it('lays a field 12 m and more from the turbines and 6 m from the buildings, and never over a field, park, yard or wood', () => {
    const wood = createForest({
      id: 'small_wood',
      kind: 'broadleaf',
      outline: [
        [-120, 380],
        [-80, 380],
        [-80, 420],
        [-120, 420],
      ],
    });
    const land = landWith({
      windTurbines: [{ x: 0, z: 0 }],
      buildings: [{ minX: 290, maxX: 310, minZ: -5, maxZ: 5 }],
      fields: [{ area: square(-400, -400, 100) }],
      parks: [{ area: square(400, -400, 60) }],
      yards: [square(400, 400, 40)],
      forests: [wood],
    });

    expect(land.isOpenForField(square(0, 20, 10))).toBe(true);
    expect(land.isOpenForField(square(0, 16, 10))).toBe(false);
    // Rims 7 m and 5 m from the building's walls.
    expect(land.isOpenForField(square(300, 17, 10))).toBe(true);
    expect(land.isOpenForField(square(300, 15, 10))).toBe(false);
    // Over, under and round what lies there already.
    expect(land.isOpenForField(square(-400, -400, 20))).toBe(false);
    expect(land.isOpenForField(square(-400, -400, 200))).toBe(false);
    expect(land.isOpenForField(square(400, -400, 200))).toBe(false);
    expect(land.isOpenForField(square(400, 400, 200))).toBe(false);
    expect(land.isOpenForField(square(-100, 400, 200))).toBe(false);
    // Beside the old field, 5 m from its edge.
    expect(land.isOpenForField(square(-305, -400, 80))).toBe(true);
  });
});
