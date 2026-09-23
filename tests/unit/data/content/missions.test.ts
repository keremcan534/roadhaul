import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { GAME_CONTENT } from '../../../../src/data/content';
import { MISSION_DIFFICULTIES, vehicleCanHaul } from '../../../../src/data/definitions/MissionDefinition';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { createRouteGuidance, routeAlongRoads } from '../../../../src/domain/world/roadRoute';

const { missions, vehicles, cargo, maps } = GAME_CONTENT;
const cargoOf = (cargoId: string) => cargo.find((candidate) => candidate.id === cargoId)!;
const trucksFor = (mission: (typeof missions)[number]) =>
  vehicles.filter((vehicle) => vehicleCanHaul(vehicle, mission, cargoOf(mission.cargoId)));
const startingTruck = vehicles.find((vehicle) => vehicle.id === DEFAULT_GAME_CONFIG.newGame.startingVehicleId)!;

/** Checks the shipped contracts as a set: the balance a field-by-field validator cannot see. */
describe('the shipped missions', () => {
  it('number twenty, the MVP content (spec §43)', () => {
    expect(missions).toHaveLength(20);
  });

  it('cover every difficulty', () => {
    expect(new Set(missions.map((mission) => mission.difficulty))).toEqual(new Set(MISSION_DIFFICULTIES));
  });

  it('give a new company several contracts for its starting truck', () => {
    const openAtStart = missions.filter(
      (mission) => (mission.requiredCompanyLevel ?? 1) === 1 && trucksFor(mission).includes(startingTruck),
    );

    expect(openAtStart.length).toBeGreaterThanOrEqual(4);
  });

  it('give every truck the garage sells work that only it can do', () => {
    for (const vehicle of vehicles.filter((candidate) => candidate !== startingTruck)) {
      const onlyThisTruck = missions.filter((mission) => {
        const trucks = trucksFor(mission);
        return trucks.length === 1 && trucks[0] === vehicle;
      });
      expect(onlyThisTruck.length, vehicle.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('never unlock before the truck they need is for sale', () => {
    for (const mission of missions) {
      const earliestTruck = Math.min(...trucksFor(mission).map((vehicle) => vehicle.requiredCompanyLevel ?? 1));
      expect(mission.requiredCompanyLevel ?? 1, mission.id).toBeGreaterThanOrEqual(earliestTruck);
    }
  });

  it('leave time to drive from bay to bay: at most 35 km/h on average by road, less for easier ones', () => {
    const world = new DrivingWorld(maps[0]!);
    const bayOf = (cityId: string) => maps[0]!.depots.find((depot) => depot.cityId === cityId)!.bay;
    const route = createRouteGuidance();
    const fastestAverageKmh = { easy: 18, normal: 25, hard: 35, expert: 35 } as const;

    for (const mission of missions) {
      const from = bayOf(mission.originCityId);
      const to = bayOf(mission.destinationCityId);
      routeAlongRoads(world.roads, from.x, from.z, to.x, to.z, route);
      const averageKmh = (route.distanceMeters / mission.timeLimitSeconds) * 3.6;

      expect(averageKmh, mission.id).toBeLessThanOrEqual(fastestAverageKmh[mission.difficulty]);
    }
  });

  it('pay more for the harder, heavier work of the bigger trucks', () => {
    const averageBaseReward = (list: typeof missions) =>
      list.reduce((sum, mission) => sum + mission.baseReward, 0) / list.length;
    const startingTruckWork = missions.filter((mission) => trucksFor(mission).includes(startingTruck));
    const biggerTruckWork = missions.filter((mission) => !trucksFor(mission).includes(startingTruck));

    expect(averageBaseReward(biggerTruckWork)).toBeGreaterThan(averageBaseReward(startingTruckWork) * 1.5);
  });
});
