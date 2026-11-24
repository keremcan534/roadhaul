import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { MAPS } from '../../../../src/data/content/maps';
import { planCoachLine } from '../../../../src/domain/coach/coachLine';
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
  });
});
