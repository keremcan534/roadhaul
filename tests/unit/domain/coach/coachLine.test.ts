import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { MAPS } from '../../../../src/data/content/maps';
import { planCharterLine, planCityLine, planCoachLine } from '../../../../src/domain/coach/coachLine';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';

const config = DEFAULT_GAME_CONFIG.coachLines;

describe.each(MAPS)('the coach line of map $id', (map) => {
  const world = new DrivingWorld(map);
  const station = (map.places ?? []).find((place) => place.kind === 'busStation')!;
  const paces = new Float64Array(world.roads.length).fill(15);
  const line = planCoachLine(world, station, { stops: config.stops, townReachMeters: config.townReachMeters, longestMeters: config.longestMeters, paces, dwellSeconds: 20 });

  it('starts beside its station and calls at three towns or more, each once, by road, no longer than it may be', () => {
    expect(line).not.toBeNull();
    const stops = line!.stops;
    expect(stops.length).toBeGreaterThanOrEqual(4);
    expect(stops.length).toBeLessThanOrEqual(config.stops);
    expect(line!.lengthMeters).toBeLessThanOrEqual(config.longestMeters);
    expect(stops[0]!.cityId).toBeNull();
    expect(Math.hypot(stops[0]!.x - station.lot.x, stops[0]!.z - station.lot.z)).toBeLessThan(40);
    const towns = stops.slice(1).map((stop) => stop.cityId);
    expect(new Set(towns).size).toBe(towns.length);
    for (const stop of stops.slice(1)) {
      expect(stop.legMeters).toBeGreaterThan(150);
      // On the road, beside the town's shelter.
      expect(world.roads.some((road) => road.contains(stop.x, stop.z))).toBe(true);
      expect(Math.hypot(stop.x - stop.shelterX, stop.z - stop.shelterZ)).toBeLessThan(30);
    }
    expect(line!.lengthMeters).toBeGreaterThan(2000);
  });

  it('keeps a timetable that only moves on, by the way and the stops', () => {
    const stops = line!.stops;
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i]!.dueSeconds).toBeGreaterThan(stops[i - 1]!.dueSeconds + stops[i]!.legMeters / 15 - 1);
    }
  });

  it('plans the same line every time', () => {
    expect(planCoachLine(world, station, { stops: config.stops, townReachMeters: config.townReachMeters, longestMeters: config.longestMeters, paces, dwellSeconds: 20 })).toEqual(line);
    expect(line!.kind).toBe('intercity');
  });

  const cityOptions = { stops: config.city.stops, reachMeters: config.city.reachMeters, longestMeters: config.city.longestMeters, paces, dwellSeconds: 20 };
  const city = planCityLine(world, station, cityOptions);

  it('also runs a city line: round the shelters near the station, by road, and back to the station', () => {
    expect(city).not.toBeNull();
    expect(city!.kind).toBe('city');
    const stops = city!.stops;
    // The station, three shelters or more, the station again.
    expect(stops.length).toBeGreaterThanOrEqual(5);
    expect(stops.length).toBeLessThanOrEqual(config.city.stops);
    expect(stops[0]!.cityId).toBeNull();
    expect(stops.at(-1)!.cityId).toBeNull();
    expect(Math.hypot(stops.at(-1)!.x - stops[0]!.x, stops.at(-1)!.z - stops[0]!.z)).toBeLessThan(40);
    const shelters = stops.slice(1, -1);
    for (const stop of shelters) {
      expect(stop.cityId).not.toBeNull();
      expect(stop.legMeters).toBeGreaterThan(150);
      expect(Math.hypot(stop.shelterX - station.lot.x, stop.shelterZ - station.lot.z)).toBeLessThanOrEqual(config.city.reachMeters);
      expect(world.roads.some((road) => road.contains(stop.x, stop.z))).toBe(true);
      expect(Math.hypot(stop.x - stop.shelterX, stop.z - stop.shelterZ)).toBeLessThan(30);
    }
    // Each shelter once, none too near another.
    for (let i = 0; i < shelters.length; i++) {
      for (let j = i + 1; j < shelters.length; j++) {
        expect(Math.hypot(shelters[i]!.shelterX - shelters[j]!.shelterX, shelters[i]!.shelterZ - shelters[j]!.shelterZ)).toBeGreaterThan(150);
      }
    }
    // Shorter than the line through the towns, and its timetable only moves on.
    expect(city!.lengthMeters).toBeGreaterThan(1500);
    expect(city!.lengthMeters).toBeLessThan(line!.lengthMeters);
    expect(city!.lengthMeters).toBeLessThanOrEqual(config.city.longestMeters * 1.2);
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i]!.dueSeconds).toBeGreaterThan(stops[i - 1]!.dueSeconds + stops[i]!.legMeters / 15 - 1);
    }
    expect(planCityLine(world, station, cityOptions)).toEqual(city);
  });

  it('runs the fans\' charter to the region\'s stadium: on from the station, off beside the stadium, by road', () => {
    const stadium = (map.places ?? []).find((place) => place.kind === 'stadium')!;
    const charter = planCharterLine(world, station, stadium, { paces, dwellSeconds: 30 })!;
    expect(charter.kind).toBe('charter');
    expect(charter.stops).toHaveLength(2);
    const [first, last] = charter.stops;
    expect(first!.cityId).toBeNull();
    expect(Math.hypot(first!.x - station.lot.x, first!.z - station.lot.z)).toBeLessThan(40);
    expect(last!.placeId).toBe(stadium.id);
    expect(world.roads.some((road) => road.contains(last!.x, last!.z))).toBe(true);
    // On the road along the stadium's lot.
    expect(Math.hypot(last!.x - stadium.lot.x, last!.z - stadium.lot.z)).toBeLessThan(stadium.lot.widthMeters / 2 + 12);
    expect(charter.lengthMeters).toBeGreaterThan(1500);
    expect(charter.lengthMeters).toBeLessThan(6000);
    expect(last!.dueSeconds).toBeGreaterThan(30 + charter.lengthMeters / 15 - 1);
  });
});
