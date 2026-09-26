import { describe, expect, it } from 'vitest';
import type { FleetMarker } from '../../../../src/systems/fleet/FleetService';
import type { RivalMarker } from '../../../../src/systems/rivals/RivalService';
import { pickOnMap } from '../../../../src/ui/map/mapPicking';
import type { MapCityLabel } from '../../../../src/ui/map/mapSketch';
import { MapViewport } from '../../../../src/ui/map/MapViewport';

/** 800 × 600 CSS px, north up, 0.5 px a meter, (0, 0) in the middle. */
function viewport(): MapViewport {
  const view = new MapViewport();
  view.resize(800, 600);
  view.scale = 0.5;
  view.turn(0);
  return view;
}

function fleetTruck(x: number, z: number): FleetMarker {
  return { key: 'driver_selin', driverId: 'driver_selin', color: 0xffffff, x, z, heading: 0, moving: true, destinationCityId: 'city_b' };
}

function rivalTruck(x: number, z: number, racing = false): RivalMarker {
  return {
    key: racing ? '' : 'rival_yeniliman:0',
    rivalId: 'rival_yeniliman',
    color: 0xd9363e,
    x,
    z,
    heading: 0,
    moving: true,
    destinationCityId: 'city_c',
    racing,
  };
}

const CITIES: readonly MapCityLabel[] = [
  { cityId: 'city_a', x: 0, z: 0 },
  { cityId: 'city_b', x: 1000, z: 0 },
];

describe('pickOnMap', () => {
  it('picks the truck whose arrow is nearest the tap, within reach, before the city it is in', () => {
    const view = viewport();
    const fleet = [fleetTruck(40, 0)];
    const rivals = [rivalTruck(-40, 0)];
    // (40, 0) is 20 px right of the middle; (-40, 0) 20 px left.
    expect(pickOnMap(view, 418, 300, fleet, 1, rivals, 1, CITIES, 260)).toEqual({ kind: 'fleet', marker: fleet[0] });
    expect(pickOnMap(view, 385, 302, fleet, 1, rivals, 1, CITIES, 260)).toEqual({ kind: 'rival', marker: rivals[0] });
    // Only the markers painted count.
    expect(pickOnMap(view, 418, 300, fleet, 0, rivals, 0, CITIES, 260)).toEqual({ kind: 'city', cityId: 'city_a' });
  });

  it('picks the arrow drawn on top of others at the same place: the last rival\'s, and the fleet\'s over any', () => {
    const view = viewport();
    const first = rivalTruck(0, 100);
    const second = { ...rivalTruck(0, 100), rivalId: 'rival_demirkent', key: 'rival_demirkent:1' };
    expect(pickOnMap(view, 400, 350, [], 0, [first, second], 2, CITIES, 260)).toEqual({ kind: 'rival', marker: second });
    const own = fleetTruck(0, 100);
    expect(pickOnMap(view, 400, 350, [own], 1, [first, second], 2, CITIES, 260)).toEqual({ kind: 'fleet', marker: own });
  });

  it('picks the city whose territory holds the tap, else nothing', () => {
    const view = viewport();
    expect(pickOnMap(view, 400 + 0.5 * 250, 300, [], 0, [], 0, CITIES, 260)).toEqual({ kind: 'city', cityId: 'city_a' });
    expect(pickOnMap(view, 400 + 0.5 * 900, 300, [], 0, [], 0, CITIES, 260)).toEqual({ kind: 'city', cityId: 'city_b' });
    expect(pickOnMap(view, 400 + 0.5 * 500, 300, [], 0, [], 0, CITIES, 260)).toBeNull();
    // Zoomed far out (the cities 20 px apart), a city is picked within 44 px of its middle, however small its
    // territory is drawn: 30 px right of city_b is 1,500 m from it, 50 px is too far.
    view.scale = 0.02;
    expect(pickOnMap(view, 400 + 20 + 30, 300, [], 0, [], 0, CITIES, 260)).toEqual({ kind: 'city', cityId: 'city_b' });
    expect(pickOnMap(view, 400 + 20 + 50, 300, [], 0, [], 0, CITIES, 260)).toBeNull();
  });

  it('knows the rival racing the company for a tender', () => {
    const view = viewport();
    const racing = rivalTruck(0, 100, true);
    expect(pickOnMap(view, 400, 350, [], 0, [racing], 1, CITIES, 260)).toEqual({ kind: 'rival', marker: racing });
  });
});
