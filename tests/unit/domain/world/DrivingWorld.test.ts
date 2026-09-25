import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../../src/data/content/maps';
import { rectangleContains } from '../../../../src/data/definitions/MapDefinition';
import { VehicleDynamics } from '../../../../src/domain/vehicles/VehicleDynamics';
import { createVehicleFootprint } from '../../../../src/domain/vehicles/VehicleFootprint';
import { DrivingWorld, type MovingObstacles } from '../../../../src/domain/world/DrivingWorld';
import { ASPHALT, GRASS } from '../../../../src/domain/world/Surface';
import { billboardLegs } from '../../../../src/domain/world/townscape';
import { mapFixture, seaFixture, vehicleFixture } from '../../../support/contentFixtures';

const truck = vehicleFixture();
const footprint = createVehicleFootprint(truck.body);
/** Centres of the front and rear footprint circles, meters ahead of the rear axle. */
const front = Math.max(...footprint.offsets);
const rear = Math.min(...footprint.offsets);

const degrees = (value: number): number => (value * Math.PI) / 180;

/** A truck whose rear axle is at (x, z), facing `headingDegrees`, rolling at `speed` m/s. */
function truckAt(x: number, z: number, headingDegrees: number, speed: number) {
  const state = new VehicleDynamics(truck).createState(x, z, degrees(headingDegrees));
  state.speed = speed;
  return state;
}

/** Centres of the footprint circles along the Z axis. */
function circleZs(state: { z: number; heading: number }): number[] {
  return footprint.offsets.map((offset) => state.z + Math.cos(state.heading) * offset);
}

interface MovingCircle {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly vx: number;
  readonly vz: number;
}

/** Traffic as the truck meets it: circles that move, and a record of every touch. */
function movingObstacles(circles: readonly MovingCircle[]): MovingObstacles & { hits: [number, number][] } {
  const hits: [number, number][] = [];
  return {
    circleCount: circles.length,
    circleX: Float64Array.from(circles, (circle) => circle.x),
    circleZ: Float64Array.from(circles, (circle) => circle.z),
    circleRadius: Float64Array.from(circles, (circle) => circle.radius),
    circleVelocityX: Float64Array.from(circles, (circle) => circle.vx),
    circleVelocityZ: Float64Array.from(circles, (circle) => circle.vz),
    hit: (index, impact) => hits.push([index, impact]),
    hits,
  };
}

describe('DrivingWorld', () => {
  const world = new DrivingWorld(mapFixture());

  it('is asphalt on the road and grass beside it', () => {
    expect(world.surfaceAt(0, 0)).toBe(ASPHALT);
    expect(world.surfaceAt(50, 4)).toBe(ASPHALT);
    expect(world.surfaceAt(50, 8)).toBe(GRASS);
  });

  it('paves depot yards: they drive like asphalt', () => {
    // The fixture's origin yard spans x -122..-78 and z -30..-4, south of the road.
    expect(world.surfaceAt(-100, -17)).toBe(ASPHALT);
    expect(world.surfaceAt(-121, -29)).toBe(ASPHALT);
    expect(world.surfaceAt(-100, -31)).toBe(GRASS);
    expect(world.surfaceAt(-124, -17)).toBe(GRASS);
  });

  it('finds the depot of a city', () => {
    expect(world.depotOf('test_destination')?.id).toBe('test_destination_depot');
    expect(world.depotOf('atlantis')).toBeUndefined();
  });

  it('takes the spawn point and heading from the map', () => {
    expect(world.spawn.x).toBe(0);
    expect(world.spawn.z).toBe(0);
    expect(world.spawn.heading).toBeCloseTo(Math.PI / 2, 12);
  });

  it('stops a truck that drives head-on into a building', () => {
    // The building spans z 35..45; the fixture truck's nose (7 m ahead of the rear axle) is 1 m inside it.
    const state = truckAt(0, 29, 0, 10);

    const impact = world.resolveCollisions(state, footprint);

    expect(impact).toBeCloseTo(10, 6);
    expect(state.speed).toBeCloseTo(0, 9);
    const noseZ = state.z + Math.cos(state.heading) * Math.max(...footprint.offsets) + footprint.radius;
    expect(noseZ).toBeLessThanOrEqual(35 + 1e-9);
  });

  it('turns a truck that glances off a wall along it, keeping its speed along the wall', () => {
    // Driving east, 15° toward the building's south wall (z = 35); two circles touch it.
    const state = truckAt(-5, 33, 75, 10);

    const impact = world.resolveCollisions(state, footprint);

    expect(impact).toBeCloseTo(10 * Math.sin(degrees(15)), 6);
    expect(state.heading).toBeCloseTo(degrees(90), 9);
    expect(state.speed).toBeCloseTo(10 * Math.cos(degrees(15)), 6);
    // Flush against the wall, not bounced off it: every circle touches, none is inside.
    for (const z of circleZs(state)) {
      expect(z + footprint.radius).toBeCloseTo(35, 6);
    }
  });

  it('turns a truck part of the way when it hits a wall at a medium angle', () => {
    // 30° to the south wall; only the front circle is 0.3 m inside it.
    const state = truckAt(-front * Math.sin(degrees(60)), 34.05 - front * Math.cos(degrees(60)), 60, 10);

    world.resolveCollisions(state, footprint);

    const turned = state.heading - degrees(60);
    expect(turned).toBeGreaterThan(degrees(5));
    expect(turned).toBeLessThan(degrees(30));
    expect(state.speed).toBeLessThan(10 * Math.cos(degrees(30)));
    expect(state.speed).toBeGreaterThan(10 * Math.cos(degrees(30)) ** 2);
  });

  it('stops without turning when it hits a wall at a steep angle', () => {
    // 60° to the south wall; only the front circle is 0.3 m inside it.
    const state = truckAt(-front * Math.sin(degrees(30)), 34.05 - front * Math.cos(degrees(30)), 30, 10);

    world.resolveCollisions(state, footprint);

    expect(state.heading).toBe(degrees(30));
    expect(state.speed).toBeCloseTo(10 * Math.cos(degrees(60)) ** 2, 6);
  });

  it('turns a truck that reverses into a wall at a shallow angle along it', () => {
    // Facing 75° (east-north-east) above the building, backing south-west into its north wall (z = 45);
    // only the rear circle is 0.3 m inside it.
    const state = truckAt(-rear * Math.sin(degrees(75)), 45.95 - rear * Math.cos(degrees(75)), 75, -3);

    const impact = world.resolveCollisions(state, footprint);

    expect(impact).toBeCloseTo(3 * Math.sin(degrees(15)), 6);
    expect(state.heading).toBeCloseTo(degrees(90), 9);
    expect(state.speed).toBeCloseTo(-3 * Math.cos(degrees(15)), 6);
  });

  it('ignores obstacles the truck is already moving away from', () => {
    // Facing the building with the nose 0.1 m inside it, but reversing away.
    const state = truckAt(0, 28.1, 0, -3);

    expect(world.resolveCollisions(state, footprint)).toBe(0);
    expect(state.speed).toBe(-3);
    expect(state.heading).toBe(0);
    expect(Math.max(...circleZs(state)) + footprint.radius).toBeCloseTo(35, 9);
  });

  it('stops a reversing truck that backs into a building', () => {
    // Facing north just past the building (z ≤ 45); the tail is 0.5 m inside it.
    const state = truckAt(0, 46.5, 0, -3);

    const impact = world.resolveCollisions(state, footprint);

    expect(impact).toBeCloseTo(3, 6);
    expect(state.speed).toBeCloseTo(0, 9);
  });

  it('keeps the truck inside the map boundary', () => {
    const state = truckAt(0, 195, 0, 20);

    world.resolveCollisions(state, footprint);

    expect(state.speed).toBeCloseTo(0, 9);
    for (const offset of footprint.offsets) {
      expect(state.z + offset + footprint.radius).toBeLessThanOrEqual(200 + 1e-9);
    }
  });

  it('does nothing when there is nothing to hit', () => {
    const state = truckAt(0, 0, 90, 20);

    expect(world.resolveCollisions(state, footprint)).toBe(0);
    expect(state).toMatchObject({ x: 0, z: 0, speed: 20 });
  });

  it('paves a turning circle at each dead end, so trucks and traffic can turn round', () => {
    // The fixture road ends at x = ±150; each circle is centred 2 m past the end.
    expect(world.turningCircles.map((circle) => [circle.x, circle.z, circle.radiusMeters])).toEqual([
      [-152, 0, 11],
      [152, 0, 11],
    ]);
    expect(world.surfaceAt(158, 8)).toBe(ASPHALT);
    expect(world.surfaceAt(160, 12)).toBe(GRASS);
  });

  describe('against traffic', () => {
    // Heading +X, the front circle's centre is `front` meters ahead of the rear axle at x = 0.
    const touching = front + footprint.radius + 0.9 - 0.2;

    it('carries a truck that runs into the back of a slower vehicle along at its speed', () => {
      const state = truckAt(0, 0, 90, 20);
      const car = movingObstacles([{ x: touching, z: 0, radius: 0.9, vx: 15, vz: 0 }]);

      const impact = world.resolveCollisions(state, footprint, car);

      expect(impact).toBeCloseTo(5, 6); // How much faster the truck was going.
      expect(state.speed).toBeCloseTo(15, 6);
      expect(car.hits).toEqual([[0, impact]]);
    });

    it('stops a truck that drives head-on into an oncoming vehicle, with both speeds in the impact', () => {
      const state = truckAt(0, 0, 90, 10);
      const car = movingObstacles([{ x: touching, z: 0, radius: 0.9, vx: -8, vz: 0 }]);

      expect(world.resolveCollisions(state, footprint, car)).toBeCloseTo(18, 6);
      expect(state.speed).toBeCloseTo(0, 6);
    });

    it('takes no impact when a vehicle drives into the truck standing still: it only shoves it', () => {
      const state = truckAt(0, 0, 90, 0);
      const car = movingObstacles([{ x: touching, z: 0, radius: 0.9, vx: -8, vz: 0 }]);

      expect(world.resolveCollisions(state, footprint, car)).toBe(0);
      expect(state.x).toBeLessThan(0);
      expect(state.speed).toBe(0);
      expect(car.hits).toEqual([[0, 0]]);
    });

    it('leaves vehicles it does not touch alone', () => {
      const state = truckAt(0, 0, 90, 20);
      const car = movingObstacles([{ x: touching, z: 3, radius: 0.9, vx: 0, vz: 0 }]);

      expect(world.resolveCollisions(state, footprint, car)).toBe(0);
      expect(car.hits).toEqual([]);
      expect(state).toMatchObject({ x: 0, z: 0, speed: 20 });
    });
  });

  describe('street lamps', () => {
    const lit = new DrivingWorld(mapFixture({ scenery: { seed: 1, treesPerKilometer: 0, streetLampSpacingMeters: 20 } }));
    /** The fixture's street runs along the X axis, 10 m wide; lamps stand 1.8 m past its edges. */
    const lampZ = 5 + 1.8;

    it('only stand where the map asks for them', () => {
      expect(world.streetLamps).toEqual([]);
      expect(lit.streetLamps.length).toBeGreaterThan(5);
    });

    it('line the street at their spacing, on alternate sides, reaching over the road', () => {
      const south = lit.streetLamps.filter((lamp) => lamp.z < 0);
      const north = lit.streetLamps.filter((lamp) => lamp.z > 0);
      expect(north.length).toBeGreaterThan(2);
      expect(south.length).toBeGreaterThan(2);
      for (const lamp of lit.streetLamps) {
        expect(Math.abs(lamp.z)).toBeCloseTo(lampZ, 6);
        expect(lit.surfaceAt(lamp.x, lamp.z)).toBe(GRASS);
        // The arm points back across the road: south of it, north (+Z); north of it, south.
        expect(Math.cos(lamp.heading)).toBeCloseTo(lamp.z < 0 ? 1 : -1, 6);
      }
      // The street runs east from x = -150; lamp n stands (n + 0.5) × 20 m along it, the first on the right
      // (+Z, heading east), the sides taking turns.
      for (const lamp of lit.streetLamps) {
        const n = (lamp.x + 150) / 20 - 0.5;
        expect(n).toBeCloseTo(Math.round(n), 6);
        expect(lamp.z > 0).toBe(Math.round(n) % 2 === 0);
      }
    });

    it('keep clear of depot yards and buildings, so trucks can manoeuvre there', () => {
      for (const lamp of lit.streetLamps) {
        for (const depot of lit.depots) {
          expect(rectangleContains(depot.yard, lamp.x, lamp.z, 7.9)).toBe(false);
        }
        // The fixture's building stands 30 m back from the road: lamps may pass it, but not stand in it.
        const box = lit.buildings[0]!;
        expect(lamp.x >= box.minX && lamp.x <= box.maxX && lamp.z >= box.minZ && lamp.z <= box.maxZ).toBe(false);
      }
    });

    it('are solid', () => {
      const lamp = lit.streetLamps[0]!;
      // The truck's front circle just short of the post, driving straight at it across the verge.
      const heading = lamp.z > 0 ? 0 : Math.PI;
      const reach = front + footprint.radius + lamp.radius - 0.2;
      const state = truckAt(lamp.x, lamp.z - Math.cos(heading) * reach, 0, 8);
      state.heading = heading;

      expect(lit.resolveCollisions(state, footprint)).toBeGreaterThan(7);
      expect(Math.abs(state.speed)).toBeLessThan(1);
    });

    it('light the towns of the shipped region, clear of its junctions, yards and other roads', () => {
      const region = new DrivingWorld(MAPS[0]!);
      expect(region.streetLamps.length).toBeGreaterThan(100);
      for (const lamp of region.streetLamps) {
        const distances = region.roads.map((road) => ({ road, edge: road.distanceTo(lamp.x, lamp.z) - road.widthMeters / 2 }));
        const nearest = distances.reduce((best, entry) => (entry.edge < best.edge ? entry : best));
        // Beside a street or the ring road, never the highway or a country road.
        expect(['street', 'ringRoad']).toContain(nearest.road.kind);
        expect(nearest.edge).toBeGreaterThan(1.7);
        expect(nearest.edge).toBeLessThan(1.9);
        for (const other of distances.filter((entry) => entry.road !== nearest.road)) {
          expect(other.edge).toBeGreaterThan(1.2);
        }
        for (const junction of region.network.junctions) {
          expect(Math.hypot(lamp.x - junction.x, lamp.z - junction.z)).toBeGreaterThan(15.9);
        }
        for (const depot of region.depots) {
          expect(rectangleContains(depot.yard, lamp.x, lamp.z, 7.9)).toBe(false);
        }
      }
    });
  });

  describe('city name boards', () => {
    const signed = new DrivingWorld(
      mapFixture({
        citySigns: [
          { cityId: 'test_origin', roadId: 'test_road', distanceMeters: 20, direction: 'forward' },
          { cityId: 'test_destination', roadId: 'test_road', distanceMeters: 290, direction: 'backward' },
        ],
      }),
    );

    it('stand beside their road, on the right of the traffic they greet, facing it', () => {
      const [west, east] = signed.citySigns;
      // Eastbound traffic (+X) has +Z on its right; the board faces back west at it.
      expect(west!.cityId).toBe('test_origin');
      expect(west!.x).toBeCloseTo(-130, 6);
      expect(west!.z).toBeCloseTo(5 + 4.6, 6);
      expect(Math.sin(west!.heading)).toBeCloseTo(-1, 6);
      // Westbound traffic has -Z on its right.
      expect(east!.x).toBeCloseTo(140, 6);
      expect(east!.z).toBeCloseTo(-(5 + 4.6), 6);
      expect(Math.sin(east!.heading)).toBeCloseTo(1, 6);
      for (const sign of signed.citySigns) {
        expect(signed.surfaceAt(sign.x, sign.z)).toBe(GRASS);
      }
    });

    it('have solid posts', () => {
      const sign = signed.citySigns[0]!;
      // The board spans across the road's direction: its posts stand 2.4 m either side of its middle, the inner
      // one 2.2 m from the road's edge. Drive east along the verge at that one.
      const postZ = sign.z - 2.4;
      const reach = front + footprint.radius + 0.12 - 0.2;
      const state = truckAt(sign.x - reach, postZ, 90, 8);

      expect(signed.resolveCollisions(state, footprint)).toBeGreaterThan(7);
      expect(Math.abs(state.speed)).toBeLessThan(1);
    });

    it('are not hidden by trees or lamps', () => {
      const region = new DrivingWorld(MAPS[0]!);
      expect(region.citySigns.length).toBeGreaterThan(0);
      for (const sign of region.citySigns) {
        for (const other of [...region.trees, ...region.streetLamps]) {
          expect(Math.hypot(other.x - sign.x, other.z - sign.z)).toBeGreaterThanOrEqual(9);
        }
      }
    });
  });

  describe('farmland and wind turbines', () => {
    // Beside the fixture's street, which runs east along z = 0, 10 m wide, from x = -150: right of it is +Z.
    const stubble = {
      roadId: 'test_road',
      fromMeters: 90,
      lengthMeters: 120,
      side: 'right',
      setbackMeters: 20,
      depthMeters: 70,
      crop: 'stubble',
    } as const;
    const wheat = { ...stubble, fromMeters: 230, lengthMeters: 50, setbackMeters: 8, depthMeters: 40, crop: 'wheat' } as const;
    const farm = new DrivingWorld(
      mapFixture({ fields: [stubble, wheat], windTurbines: [{ x: -150, z: -120 }], buildings: [] }),
    );

    it('lays each field beside its stretch of road, set back from the edge, rows along the road', () => {
      const [stubbleField, wheatField] = farm.fields;
      expect(stubbleField!.area).toMatchObject({ headingDegrees: 90, widthMeters: 70 });
      expect(stubbleField!.area.lengthMeters).toBeCloseTo(120, 9);
      expect(stubbleField!.area.x).toBeCloseTo(0, 9);
      expect(stubbleField!.area.z).toBeCloseTo(5 + 20 + 35, 9);
      expect(wheatField!.area.x).toBeCloseTo(105, 9);
      expect(wheatField!.area.z).toBeCloseTo(5 + 8 + 20, 9);
      expect(wheatField!.crop).toBe('wheat');
    });

    it('keeps a field clear of its road where the road bends toward it', () => {
      const bend = new DrivingWorld(
        mapFixture({
          roads: [
            {
              id: 'bend',
              kind: 'rural',
              widthMeters: 8,
              closed: false,
              controlPoints: [
                [-100, 0],
                [0, 30],
                [100, 0],
              ],
            },
          ],
          depots: [],
          buildings: [],
          fields: [{ roadId: 'bend', fromMeters: 0, lengthMeters: 400, side: 'right', setbackMeters: 6, depthMeters: 50, crop: 'green' }],
        }),
      );
      const [field] = bend.fields;
      const road = bend.roads[0]!;
      // Nowhere does the road come closer to the field than its setback.
      for (let i = 0; i < road.pointCount; i++) {
        const insideBy = field!.area.z - field!.area.widthMeters / 2 - road.z(i);
        expect(insideBy).toBeGreaterThanOrEqual(road.widthMeters / 2 + 6 - 1e-6);
      }
    });

    it('lays hay bales in rows on the harvested fields only, clear of their edges, the same every time', () => {
      const [stubbleField, wheatField] = farm.fields;
      expect(farm.hayBales.length).toBeGreaterThan(10);
      for (const bale of farm.hayBales) {
        expect(rectangleContains(stubbleField!.area, bale.x, bale.z, -5.9)).toBe(true);
        expect(rectangleContains(wheatField!.area, bale.x, bale.z)).toBe(false);
      }
      // Rows run along the field (east-west here), 22 m apart.
      const rows = new Set(farm.hayBales.map((bale) => Math.round(bale.z * 1000) / 1000));
      expect(rows.size).toBe(3);
      expect(new DrivingWorld(mapFixture({ fields: [stubble, wheat], buildings: [] })).hayBales).toEqual(farm.hayBales);
    });

    it('makes bales and turbine towers solid, and fields drive like grass', () => {
      const wheatArea = farm.fields[1]!.area;
      expect(farm.surfaceAt(wheatArea.x, wheatArea.z)).toBe(GRASS);
      for (const obstacle of [farm.hayBales[0]!, farm.windTurbines[0]!]) {
        // The truck's front circle just short of it, driving north.
        const reach = front + footprint.radius + obstacle.radius - 0.2;
        const state = truckAt(obstacle.x, obstacle.z - reach, 0, 8);

        expect(farm.resolveCollisions(state, footprint)).toBeGreaterThan(7);
        expect(Math.abs(state.speed)).toBeLessThan(1);
      }
    });

    it('keeps the region\'s trees out of its fields and away from its turbines', () => {
      const region = new DrivingWorld(MAPS[0]!);
      expect(region.fields.length).toBeGreaterThan(0);
      expect(region.windTurbines.length).toBeGreaterThan(0);
      for (const tree of region.trees) {
        for (const field of region.fields) {
          expect(rectangleContains(field.area, tree.x, tree.z, 2.9)).toBe(false);
        }
        for (const turbine of region.windTurbines) {
          expect(Math.hypot(tree.x - turbine.x, tree.z - turbine.z)).toBeGreaterThan(11.9);
        }
      }
    });
  });

  describe('guard rails', () => {
    const region = new DrivingWorld(MAPS[0]!);
    /** A piece in the middle of the longest rail: its ends, its direction and the way to its road. */
    const rail = region.guardRails.reduce((best, candidate) => (candidate.points.length > best.points.length ? candidate : best));
    const middle = Math.floor(rail.points.length / 2);
    const [ax, az] = rail.points[middle]!;
    const [bx, bz] = rail.points[middle + 1]!;
    const length = Math.hypot(bx - ax, bz - az);
    const along = { x: (bx - ax) / length, z: (bz - az) / length };
    const toRoad = rail.roadSide === 'left' ? 1 : -1;
    const roadward = { x: along.z * toRoad, z: -along.x * toRoad };
    const midX = (ax + bx) / 2;
    const midZ = (az + bz) / 2;
    /** How far the front footprint circle's centre is from the rail's line, on the road's side (negative: beyond it). */
    const frontClearance = (state: { x: number; z: number; heading: number }): number =>
      (state.x + Math.sin(state.heading) * front - ax) * roadward.x + (state.z + Math.cos(state.heading) * front - az) * roadward.z;

    it("line the outside of the ring road's sharp corners in the shipped region, beside the road and clear of junctions and yards", () => {
      expect(region.guardRails.length).toBeGreaterThanOrEqual(4);
      for (const { points } of region.guardRails) {
        for (const [x, z] of points) {
          const distances = region.roads.map((road) => ({ road, edge: road.distanceTo(x, z) - road.widthMeters / 2 }));
          const nearest = distances.reduce((best, entry) => (entry.edge < best.edge ? entry : best));
          expect(['ringRoad', 'rural', 'highway']).toContain(nearest.road.kind);
          expect(nearest.edge).toBeGreaterThan(1);
          expect(nearest.edge).toBeLessThan(1.4);
          for (const other of distances.filter((entry) => entry.road !== nearest.road)) {
            expect(other.edge).toBeGreaterThan(1);
          }
          expect(region.surfaceAt(x, z)).toBe(GRASS);
          for (const junction of region.network.junctions) {
            expect(Math.hypot(x - junction.x, z - junction.z)).toBeGreaterThan(17.9);
          }
          for (const depot of region.depots) {
            expect(rectangleContains(depot.yard, x, z, 7.9)).toBe(false);
          }
        }
      }
      // The road is on the side the rail says.
      const ring = region.roads.find((road) => road.kind === 'ringRoad')!;
      expect(ring.distanceTo(midX + roadward.x, midZ + roadward.z)).toBeLessThan(ring.distanceTo(midX - roadward.x, midZ - roadward.z));
    });

    it('are solid: a truck driving straight at one stops against it', () => {
      const heading = Math.atan2(-roadward.x, -roadward.z);
      const state = truckAt(0, 0, 0, 12);
      state.heading = heading;
      // The front circle 0.3 m into the rail.
      const back = front + footprint.radius + 0.2 - 0.3;
      state.x = midX - Math.sin(heading) * back;
      state.z = midZ - Math.cos(heading) * back;

      expect(region.resolveCollisions(state, footprint)).toBeCloseTo(12, 6);
      expect(Math.abs(state.speed)).toBeLessThan(1e-6);
      expect(frontClearance(state)).toBeGreaterThanOrEqual(footprint.radius + 0.2 - 1e-9);
    });

    it('turn a truck that glances off one along it', () => {
      // 10° toward the rail, driving along it.
      const heading = Math.atan2(along.x, along.z) + degrees(10) * (rail.roadSide === 'left' ? -1 : 1);
      const state = truckAt(0, 0, 0, 15);
      state.heading = heading;
      const aimed = { x: Math.sin(heading), z: Math.cos(heading) };
      // Into the rail by 0.2 m with the front circle.
      expect(aimed.x * roadward.x + aimed.z * roadward.z).toBeLessThan(0);
      const reach = footprint.radius + 0.2 - 0.2;
      state.x = midX + roadward.x * reach - aimed.x * front;
      state.z = midZ + roadward.z * reach - aimed.z * front;

      expect(region.resolveCollisions(state, footprint)).toBeGreaterThan(0);
      // Along the rail, most of the speed kept.
      expect(Math.abs(Math.sin(state.heading) * roadward.x + Math.cos(state.heading) * roadward.z)).toBeLessThan(0.02);
      expect(state.speed).toBeGreaterThan(14);
    });

    it('never let a fast truck through', () => {
      const heading = Math.atan2(-roadward.x, -roadward.z) + degrees(25);
      const state = truckAt(0, 0, 0, 0);
      state.heading = heading;
      const start = front + footprint.radius + 6;
      state.x = midX + roadward.x * start - Math.sin(heading) * front;
      state.z = midZ + roadward.z * start - Math.cos(heading) * front;
      const step = 1 / 60;
      for (let frame = 0; frame < 120; frame++) {
        // Flat out at 110 km/h, every step.
        state.speed = 30;
        state.x += Math.sin(state.heading) * state.speed * step;
        state.z += Math.cos(state.heading) * state.speed * step;
        region.resolveCollisions(state, footprint);
        expect(frontClearance(state)).toBeGreaterThan(footprint.radius);
      }
    });
  });

  describe('trees', () => {
    const map = MAPS[0]!;
    const forest = new DrivingWorld(map);

    it('are generated deterministically from the seed', () => {
      expect(new DrivingWorld(map).trees).toEqual(forest.trees);
      expect(new DrivingWorld({ ...map, scenery: { ...map.scenery, seed: 1 } }).trees).not.toEqual(forest.trees);
    });

    it('line the roads without standing on them, near the start or outside the map', () => {
      expect(forest.trees.length).toBeGreaterThan(100);
      for (const tree of forest.trees) {
        expect(forest.surfaceAt(tree.x, tree.z)).toBe(GRASS);
        expect(Math.min(...forest.roads.map((road) => road.distanceTo(tree.x, tree.z)))).toBeGreaterThan(8);
        expect(Math.hypot(tree.x - forest.spawn.x, tree.z - forest.spawn.z)).toBeGreaterThan(19);
        expect(Math.abs(tree.x)).toBeLessThan(map.halfSizeMeters);
        expect(Math.abs(tree.z)).toBeLessThan(map.halfSizeMeters);
      }
    });

    it('keep clear of turning circles', () => {
      expect(forest.turningCircles.length).toBeGreaterThan(0);
      for (const tree of forest.trees) {
        for (const circle of forest.turningCircles) {
          expect(Math.hypot(tree.x - circle.x, tree.z - circle.z)).toBeGreaterThan(circle.radiusMeters + 3);
        }
      }
    });

    it('keep clear of depot yards, so trucks can manoeuvre there', () => {
      for (const tree of forest.trees) {
        for (const depot of forest.depots) {
          expect(rectangleContains(depot.yard, tree.x, tree.z, 5.9)).toBe(false);
        }
      }
    });

    it('are solid', () => {
      const tree = forest.trees[0]!;
      // Place the truck's front circle just short of the trunk, driving straight at it.
      const heading = Math.atan2(tree.x - forest.spawn.x, tree.z - forest.spawn.z);
      const frontOffset = Math.max(...footprint.offsets);
      const reach = frontOffset + footprint.radius + tree.radius - 0.2;
      const state = truckAt(0, 0, 0, 8);
      state.heading = heading;
      state.x = tree.x - Math.sin(heading) * reach;
      state.z = tree.z - Math.cos(heading) * reach;

      expect(forest.resolveCollisions(state, footprint)).toBeGreaterThan(7);
      expect(Math.abs(state.speed)).toBeLessThan(1);
    });
  });

  describe('by the sea', () => {
    const coast = new DrivingWorld(
      mapFixture({ sea: seaFixture(), scenery: { seed: 11, treesPerKilometer: 400, streetLampSpacingMeters: 12 } }),
    );

    it('is water west of the shore, paved on the quay and grass on the beach', () => {
      expect(coast.isWater(-181, 100)).toBe(true);
      expect(coast.isWater(-179, 100)).toBe(false);
      expect(coast.isWater(-179, 100, 2)).toBe(true);
      // The quay runs from z -30 to 30, 25 m back from the water's edge.
      expect(coast.isOnQuay(-170, 0)).toBe(true);
      expect(coast.isOnQuay(-150, 0)).toBe(false);
      expect(coast.isOnQuay(-170, 50)).toBe(false);
      expect(coast.surfaceAt(-170, 20)).toBe(ASPHALT);
      expect(coast.surfaceAt(-170, 100)).toBe(GRASS);
    });

    it('stops the truck at the water\'s edge', () => {
      // Driving west, its front circle already past the shore.
      const state = truckAt(-181 + front, 100, -90, 10);

      const impact = coast.resolveCollisions(state, footprint);

      expect(impact).toBeCloseTo(10, 6);
      expect(state.speed).toBeCloseTo(0, 9);
      // Every footprint circle is back on land, a kerb's width short of the water.
      for (const offset of footprint.offsets) {
        const centreX = state.x + Math.sin(state.heading) * offset;
        expect(centreX - footprint.radius).toBeGreaterThanOrEqual(-180 + 0.4 - 1e-9);
      }
    });

    it('lets the truck drive along the shore', () => {
      const state = truckAt(-180 + footprint.radius + 0.5, 100, 0, 10);

      expect(coast.resolveCollisions(state, footprint)).toBe(0);
      expect(state.speed).toBe(10);
    });

    it('lays boulders along the natural shore, either side of the waterline, and none along the quay', () => {
      expect(coast.sea!.rocks.length).toBeGreaterThan(40);
      for (const rock of coast.sea!.rocks) {
        expect(Math.abs(rock.x + 180)).toBeLessThanOrEqual(1.4 + 1e-9);
        expect(Math.abs(rock.z)).toBeGreaterThan(30);
        expect(rock.size).toBeGreaterThan(0);
      }
    });

    it('keeps trees and street lamps out of the sea, off the beach and off the quay', () => {
      expect(coast.trees.length).toBeGreaterThan(0);
      for (const tree of coast.trees) {
        expect(coast.isWater(tree.x, tree.z, 13.9)).toBe(false);
        expect(coast.isOnQuay(tree.x, tree.z, 5.9)).toBe(false);
      }
      expect(coast.streetLamps.length).toBeGreaterThan(0);
      for (const lamp of coast.streetLamps) {
        expect(coast.isWater(lamp.x, lamp.z, 2.9)).toBe(false);
        expect(coast.isOnQuay(lamp.x, lamp.z)).toBe(false);
      }
    });

    it('turns the boats and cranes to their headings, and stands the cranes on solid legs', () => {
      const sea = coast.sea!;
      expect(sea.boats).toEqual([{ kind: 'tug', x: -192, z: 0, heading: 0 }]);
      expect(sea.cranes[0]!.heading).toBeCloseTo(-Math.PI / 2, 12);

      // The crane at (-172, 10) reaches west: its legs stand 4 m either side of it in x, 3.2 m in z.
      // Drive south at the leg at (-168, 13.2), the front circle just short of it.
      const reach = front + footprint.radius + 0.5 - 0.2;
      const state = truckAt(-168, 13.2 - reach, 0, 8);
      expect(coast.resolveCollisions(state, footprint)).toBeGreaterThan(7);
      expect(Math.abs(state.speed)).toBeLessThan(1);
    });

    it('has no sea on a map without one', () => {
      expect(world.sea).toBeNull();
      expect(world.isWater(-199, 0)).toBe(false);
      expect(world.isOnQuay(-170, 0)).toBe(false);
    });
  });

  describe('the streetscape and the countryside', () => {
    /** The fixture's street along z = 0 (x -150..150), and a country road 150 m south of it, a field beside that. */
    const country = {
      id: 'test_country',
      kind: 'rural',
      widthMeters: 8,
      closed: false,
      controlPoints: [
        [-560, -150],
        [560, -150],
      ],
    } as const;
    const field = {
      roadId: 'test_country',
      fromMeters: 500,
      lengthMeters: 120,
      side: 'right',
      setbackMeters: 12,
      depthMeters: 40,
      crop: 'wheat',
    } as const;
    const map = mapFixture({ halfSizeMeters: 600, roads: [...mapFixture().roads, country], fields: [field] });
    const scenic = new DrivingWorld({ ...map, scenery: { ...map.scenery, streetscape: true, countryside: true } });
    const plain = new DrivingWorld(map);

    /** Drives the truck's front circle straight at (x, z) from the north (or the south), just short of touching. */
    const hits = (x: number, z: number, radius: number, fromSouth = false): boolean => {
      const heading = fromSouth ? 0 : Math.PI;
      const reach = front + footprint.radius + radius - 0.2;
      const state = truckAt(x, z - Math.cos(heading) * reach, 0, 8);
      state.heading = heading;
      return scenic.resolveCollisions(state, footprint) > 7 && Math.abs(state.speed) < 1;
    };

    it('only comes where the map asks for it', () => {
      for (const key of ['sidewalks', 'streetFurniture', 'billboards', 'speedSigns', 'powerLines', 'fieldEdges', 'rocks', 'grazers'] as const) {
        expect(plain[key], key).toEqual([]);
      }
      expect(plain.trees.every((tree) => tree.species === undefined)).toBe(true);
      expect(scenic.sidewalks.length).toBeGreaterThan(0);
      expect(scenic.streetFurniture.length).toBeGreaterThan(0);
      expect(scenic.billboards.length).toBeGreaterThan(0);
      expect(scenic.powerLines.length).toBeGreaterThan(0);
      expect(scenic.fieldEdges).toHaveLength(2);
      expect(scenic.rocks.length).toBeGreaterThan(0);
      expect(scenic.grazers.length).toBeGreaterThan(0);
      expect(scenic.trees.some((tree) => tree.species === 'cypress')).toBe(true);
    });

    it("paves the street's pavements, clear of the depot yards: they drive like asphalt", () => {
      // Right of the street (+z) all along; the left broken where the yards open off it.
      expect(scenic.surfaceAt(0, 6.5)).toBe(ASPHALT);
      expect(scenic.surfaceAt(0, -6.5)).toBe(ASPHALT);
      expect(scenic.surfaceAt(0, 8)).toBe(GRASS);
      expect(plain.surfaceAt(0, 6.5)).toBe(GRASS);
      for (const sidewalk of scenic.sidewalks.filter((candidate) => candidate.side === -1)) {
        for (const depot of scenic.depots) {
          const x = -150 + (sidewalk.fromMeters + sidewalk.toMeters) / 2;
          expect(rectangleContains(depot.yard, x, -6.3, 1.9)).toBe(false);
        }
      }
      expect(scenic.sidewalks.filter((sidewalk) => sidewalk.side === -1).length).toBeGreaterThan(1);
    });

    it('makes the benches, bins, shelters, billboard legs, speed signs, poles, boulders and animals solid', () => {
      const bench = scenic.streetFurniture.find((item) => item.kind === 'bench' && item.z > 0)!;
      expect(hits(bench.x, bench.z, bench.radius, true)).toBe(true);
      const shelter = scenic.streetFurniture.find((item) => item.kind === 'busStop')!;
      expect(hits(shelter.x, shelter.z, shelter.radius, true)).toBe(true);
      const leg = billboardLegs(scenic.billboards[0]!)[0]!;
      expect(hits(leg.x, leg.z, leg.radius)).toBe(true);
      const pole = scenic.powerLines[0]!.poles[3]!;
      expect(hits(pole.x, pole.z, pole.radius, pole.z > -150)).toBe(true);
      const rock = scenic.rocks.find((candidate) => candidate.radius > 0.4)!;
      expect(hits(rock.x, rock.z, rock.radius)).toBe(true);
      const cow = scenic.grazers[0]!;
      expect(hits(cow.x, cow.z, cow.radius)).toBe(true);
    });

    it('keeps it all off the roads, and the country clear of the fields', () => {
      const solid = [
        ...scenic.streetFurniture,
        ...scenic.billboards.flatMap(billboardLegs),
        ...scenic.speedSigns,
        ...scenic.powerLines.flatMap((line) => line.poles),
        ...scenic.rocks,
        ...scenic.grazers,
      ];
      for (const thing of solid) {
        expect(scenic.roads.every((road) => road.distanceTo(thing.x, thing.z) > road.widthMeters / 2)).toBe(true);
      }
      for (const thing of [...scenic.rocks, ...scenic.grazers]) {
        expect(scenic.fields.some(({ area }) => rectangleContains(area, thing.x, thing.z))).toBe(false);
      }
    });

    it('dresses the shipped region: its towns and its countryside', () => {
      const region = new DrivingWorld(MAPS[0]!);
      expect(region.sidewalks.length).toBeGreaterThan(6);
      expect(region.streetFurniture.filter((item) => item.kind === 'busStop').length).toBeGreaterThanOrEqual(2);
      expect(region.billboards.length).toBeGreaterThanOrEqual(4);
      expect(region.speedSigns.length).toBeGreaterThanOrEqual(8);
      expect(region.powerLines.flatMap((line) => line.poles).length).toBeGreaterThan(60);
      expect(region.fieldEdges.length).toBe(region.fields.length * 2);
      expect(region.rocks.length).toBeGreaterThan(80);
      expect(region.grazers.length).toBeGreaterThan(40);
      for (const species of ['poplar', 'cypress', 'olive'] as const) {
        expect(region.trees.filter((tree) => tree.species === species).length, species).toBeGreaterThan(20);
      }
    });
  });
});
