// The region's geometry for the trailer's shots, from the game's own pure modules (loaded through Vite, as the game
// builds them): lane centre paths for the autopilot (drive.js), spawns and saved placements on the roads, the fleet's
// job routes, and the trucks' handling.
import { join } from 'node:path';
import { runnerImport } from 'vite';
import { ROOT } from '../storeKit.mjs';

const load = async (path) =>
  (await runnerImport(join(ROOT, path), { root: ROOT, configFile: false, logLevel: 'silent' })).module;

const [{ MAPS }, { CITIES }, { VEHICLES }, { DrivingWorld }, { createRoadPoint, sampleCatmullRom }, { laneOffsetMeters }, { DepotRoads }] =
  await Promise.all([
    load('src/data/content/maps.ts'),
    load('src/data/content/cities.ts'),
    load('src/data/content/vehicles.ts'),
    load('src/domain/world/DrivingWorld.ts'),
    load('src/domain/world/RoadPath.ts'),
    load('src/domain/world/lanes.ts'),
    load('src/systems/fleet/DepotRoads.ts'),
  ]);

const world = new DrivingWorld(MAPS[0]);
export const vehicles = Object.fromEntries(VEHICLES.map((vehicle) => [vehicle.id, vehicle]));

/** What the autopilot needs to know of a truck's steering. */
export function handlingOf(truckId) {
  const vehicle = vehicles[truckId];
  return {
    wheelbase: vehicle.body.wheelbaseMeters,
    maxSteerDeg: vehicle.handling.maxSteerAngleDegrees,
    steerSpeedDeg: vehicle.handling.steerSpeedDegreesPerSecond,
    latG: vehicle.handling.maxLateralAccelerationG,
  };
}

function road(id) {
  const found = world.roads.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`No road ${id}`);
  return found;
}

const point = createRoadPoint();
/** A point `m` metres along road `id`, in lane `laneIndex` for travel in direction `dir` (+1 with the road's points). */
export function laneAt(id, m, dir = 1, laneIndex = 0) {
  const r = road(id);
  r.pointAt(m, point);
  const fx = point.directionX * dir;
  const fz = point.directionZ * dir;
  const offset = laneOffsetMeters(r.kind, r.widthMeters, laneIndex);
  // Right of the direction of travel (sin h, cos h) is (-cos h, sin h) = (-fz, fx).
  const heading = Math.atan2(fx, fz);
  return { x: point.x - fz * offset, z: point.z + fx * offset, heading, headingDeg: (heading * 180) / Math.PI, fx, fz };
}

/** The lane's centre from `from` to `to` metres along road `id` (to < from drives against the road's points). */
export function lanePath(id, from, to, laneIndex = 0, step = 2) {
  const dir = to >= from ? 1 : -1;
  const x = [];
  const z = [];
  const count = Math.max(2, Math.ceil(Math.abs(to - from) / step) + 1);
  for (let i = 0; i < count; i++) {
    const p = laneAt(id, from + ((to - from) * i) / (count - 1), dir, laneIndex);
    x.push(p.x);
    z.push(p.z);
  }
  return { x, z };
}

/** ?spawn= for the truck at `m` metres along road `id`, in the lane, heading along it. */
export function spawnAt(id, m, dir = 1, laneIndex = 0) {
  const p = laneAt(id, m, dir, laneIndex);
  const round = (value) => Math.round(value * 100) / 100;
  return `${round(p.x)},${round(p.z)},${round(p.headingDeg)}`;
}

/** A saved truck placement at `m` metres along road `id`, in the lane. */
export function placeAt(id, m, dir = 1, laneIndex = 0) {
  const p = laneAt(id, m, dir, laneIndex);
  return { x: p.x, z: p.z, headingRadians: p.heading };
}

/** Metres along road `id` of its point nearest (x, z). */
export function alongOf(id, x, z) {
  const r = road(id);
  return r.distances[r.nearestSampleIndex(x, z)];
}

/** A smooth path through [[x, z], …] (Catmull-Rom, as the game's roads), a point every `spacing` metres. */
export function curve(points, spacing = 2) {
  const flat = sampleCatmullRom(points, false, spacing);
  const x = [];
  const z = [];
  for (let i = 0; i < flat.length; i += 2) {
    x.push(flat[i]);
    z.push(flat[i + 1]);
  }
  return { x, z };
}

/** Metres along `path` to its point nearest (x, z). */
export function alongPath(path, x, z) {
  let total = 0;
  let best = Infinity;
  let at = 0;
  for (let i = 0; i < path.x.length; i++) {
    if (i > 0) total += Math.hypot(path.x[i] - path.x[i - 1], path.z[i] - path.z[i - 1]);
    const d = Math.hypot(path.x[i] - x, path.z[i] - z);
    if (d < best) {
      best = d;
      at = total;
    }
  }
  return at;
}

/** The fleet's route between two cities, as the game's fleet plans it. */
export function fleetRoute(origin, destination) {
  const roads = new DepotRoads({ cities: { all: CITIES }, cargo: { all: [] } }, { isDriving: true, world });
  return roads.route(origin, destination);
}

/**
 * Delineator posts stand every 40 m from 20 m along highways and country roads: `m` moved so the nearest post stands
 * just behind it (the truck coming from -dir), out of a low lens.
 */
export function behindPost(m, dir) {
  return 20 + 40 * Math.round((m - 20) / 40) - dir * 1.2;
}
