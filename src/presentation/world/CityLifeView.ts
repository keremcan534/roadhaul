import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Points,
  ShaderMaterial,
  Vector3,
  type Camera,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SeededRandom } from '../../core/random/SeededRandom';
import { CITY_VEHICLE_KINDS, type CityVehicleKind } from '../../data/definitions/CityIncident';
import { shorelineXAt } from '../../data/definitions/MapDefinition';
import type { TrafficVehicleDefinition } from '../../data/definitions/TrafficVehicleDefinition';
import type { Sea } from '../../domain/world/DrivingWorld';
import type { CityIncident } from '../../systems/world/CityIncidentService';
import { createParticleSpawn, ParticlePool } from '../effects/ParticlePool';
import { vehicleGeometry } from '../traffic/TrafficView';
import { LampGlows } from '../vehicles/LampGlows';
import type { PrelitMaterials } from './lighting';

/** What the city's happenings are, as CityIncidentService has them. */
export interface CityLifeSource {
  readonly incident: CityIncident | null;
  readonly elapsedSeconds: number;
  readonly vehicleKinds: readonly CityVehicleKind[];
  readonly vehicleX: Float64Array;
  readonly vehicleZ: Float64Array;
  readonly vehicleHeading: Float64Array;
}

/** A firework climbs this long before it bursts, seconds: its bang comes this much after the launch, and the distance's delay. */
export const FIREWORK_RISE_SECONDS = 1.1;

/** What was heard this frame, for the sound: the nearest siren, and the fireworks launched. */
export interface CityLifeSounds {
  /** Meters to the nearest siren wailing; Infinity for none. */
  sirenMeters: number;
  /** Fireworks launched this frame (each bursts FIREWORK_RISE_SECONDS later), and the nearest one's distance, meters. */
  bursts: number;
  burstMeters: number;
}

const BLUE = 0x2f6dff;
const RED = 0xff2f2f;
/** The beacons flash this many times a second. */
const FLASH_HZ = 2.6;
/** The incident's vehicles' beacons and the fire are drawn within this distance of the eye, meters. */
const INCIDENT_DRAW_METERS = 950;

/** The vehicles' bodies, after the traffic's (TrafficView), in their own colours. */
const VEHICLE_BODIES: Readonly<Record<CityVehicleKind, { readonly type: TrafficVehicleDefinition; readonly paint: number }>> = {
  fire_engine: { type: trafficType('truck', 8.6, 2.5, 3.2), paint: 0xc8211d },
  ambulance: { type: trafficType('minibus', 6.4, 2.15, 2.7), paint: 0xf4f1e8 },
  police: { type: trafficType('car', 4.8, 1.84, 1.48, 'saloon'), paint: 0xf2f4f6 },
  getaway: { type: trafficType('car', 4.4, 1.8, 1.42), paint: 0x1b1d22 },
};

/** Where each vehicle's beacons sit (x across, y up, z along from its middle), and their colours. */
const BEACONS: Readonly<Record<CityVehicleKind, readonly (readonly [number, number, number, number])[]>> = {
  fire_engine: [
    [0.6, 3.35, 3.6, BLUE],
    [-0.6, 3.35, 3.6, BLUE],
  ],
  ambulance: [
    [0.55, 2.82, 2.6, BLUE],
    [-0.55, 2.82, 2.6, BLUE],
  ],
  police: [
    [0.35, 1.62, -0.2, BLUE],
    [-0.35, 1.62, -0.2, RED],
  ],
  getaway: [],
};
const MAX_BEACONS = 6;

/** The fireworks: this many shells in the air at once, each this many sparks. */
const SHELLS = 6;
const SPARKS = 110;
/** A shell climbs for this long, then bursts and its sparks fade over this long, seconds. */
const RISE_SECONDS = FIREWORK_RISE_SECONDS;
const BURST_SECONDS = 2.6;
const FIREWORK_COLORS = [0xff4040, 0x40ff7a, 0x4a8cff, 0xffd84a, 0xff4af0, 0xffffff, 0x4afff0, 0xff9a3a] as const;

/** A plane crosses the sky every so often, this high and this fast, from out of the haze to back into it. */
const PLANE_GAP_SECONDS: readonly [number, number] = [110, 240];
const PLANE_ALTITUDE: readonly [number, number] = [280, 360];
const PLANE_SPEED = 72;
const PLANE_REACH = 1100;
/** The helicopter: over an incident this high, round it this wide; otherwise a pass now and then. */
const HELICOPTER_ALTITUDE = 70;
const HELICOPTER_ORBIT = 75;
const HELICOPTER_SPEED = 32;
const HELICOPTER_GAP_SECONDS: readonly [number, number] = [180, 360];
/** The ship sails this far out from the shore, this fast, m/s. */
const SHIP_OFFSHORE = 460;
const SHIP_SPEED = 6.5;

const scratch = new Vector3();

/**
 * The city's life over and around the truck: what CityIncidentService
 * starts (the fire brigade, an ambulance and the police at a burning
 * building, its flames and smoke and the water on it; a police chase; a
 * town's fireworks at night), and what passes by now and then: an airliner
 * high up, a helicopter (over an incident, or crossing), and a cargo ship
 * out at sea. The vehicles flash their beacons and glow at night. Built
 * once; everything hidden while it is not there (no draw calls).
 * Allocation-free per frame.
 */
export class CityLifeView {
  private readonly root = new Group();
  private readonly lambert = new MeshLambertMaterial({ vertexColors: true });
  private readonly beaconMaterials: Readonly<Record<number, MeshBasicMaterial>> = {
    [BLUE]: new MeshBasicMaterial({ color: BLUE, toneMapped: false }),
    [RED]: new MeshBasicMaterial({ color: RED, toneMapped: false }),
  };
  private readonly dimBeacon = new MeshBasicMaterial({ color: 0x2a2d33 });
  private readonly geometries: BufferGeometry[] = [];
  /** Per slot: the vehicle shown there (made the first time a kind is needed in it), and its beacons. */
  private readonly slots: Partial<Record<CityVehicleKind, VehicleSlot>>[] = [{}, {}, {}];
  private readonly beaconGlows = new LampGlows(MAX_BEACONS, 2.2);
  private readonly fireGlow = new LampGlows(1, 30);
  private readonly flames: ParticlePool;
  private readonly smoke: ParticlePool;
  private readonly puff = createParticleSpawn();
  private readonly fireworks: Fireworks;
  private readonly plane: Mesh;
  private readonly planeLights = new LampGlows(3, 4);
  private readonly helicopter: Group;
  private readonly rotor: Mesh;
  private readonly helicopterLight = new LampGlows(1, 3);
  private readonly ship: Group | null;
  private readonly shipLights = new LampGlows(3, 5);
  private readonly random = new SeededRandom(4711);
  private time = 0;
  // The plane's pass: where it started, its direction, how far along; untilPlane counts down to the next.
  private untilPlane: number;
  private planeAlong = Number.POSITIVE_INFINITY;
  private readonly planeFrom = new Vector3();
  private readonly planeDirection = new Vector3();
  // The helicopter's pass when no incident holds it.
  private untilHelicopter: number;
  private helicopterAlong = Number.POSITIVE_INFINITY;
  private readonly helicopterFrom = new Vector3();
  private readonly helicopterDirection = new Vector3();
  private orbitAngle = 0;
  private shipZ = 0;
  private shipDirection = 1;
  private sinceFireworks = 0;
  readonly sounds: CityLifeSounds = { sirenMeters: Number.POSITIVE_INFINITY, bursts: 0, burstMeters: Number.POSITIVE_INFINITY };

  constructor(
    scene: Scene,
    private readonly sea: Sea | null,
    private readonly halfSizeMeters: number,
    prelit: PrelitMaterials,
  ) {
    this.root.name = 'cityLife';
    scene.add(this.root);
    for (const glows of [this.beaconGlows, this.fireGlow, this.planeLights, this.helicopterLight, this.shipLights]) {
      this.root.add(glows.points);
    }
    // Flames shine with their own light; the smoke and the water darken with the day.
    this.flames = new ParticlePool(scene, 160);
    this.smoke = new ParticlePool(scene, 130, prelit);
    this.fireworks = new Fireworks();
    this.root.add(this.fireworks.points);
    this.plane = new Mesh(this.track(planeGeometry()), this.lambert);
    this.plane.visible = false;
    this.root.add(this.plane);
    const helicopter = helicopterGeometry();
    this.helicopter = new Group();
    this.helicopter.add(new Mesh(this.track(helicopter.body), this.lambert));
    this.rotor = new Mesh(this.track(helicopter.rotor), this.lambert);
    this.rotor.position.set(0, 2.35, 0.2);
    this.helicopter.add(this.rotor);
    this.helicopter.visible = false;
    this.root.add(this.helicopter);
    if (sea !== null && sea.shoreline.length >= 2) {
      this.ship = new Group();
      this.ship.add(new Mesh(this.track(shipGeometry()), this.lambert));
      this.root.add(this.ship);
      this.shipZ = -halfSizeMeters * 0.6;
    } else {
      this.ship = null;
    }
    this.untilPlane = this.random.range(20, 60);
    this.untilHelicopter = this.random.range(60, 120);
    for (let i = 0; i < 3; i++) {
      this.planeLights.setColor(i, [0xff3030, 0x30ff60, 0xffffff][i]!);
    }
    this.helicopterLight.setColor(0, 0xff3030);
    for (let i = 0; i < 3; i++) {
      this.shipLights.setColor(i, [0xfff4dc, 0xff3030, 0x30ff60][i]!);
    }
  }

  /**
   * Per frame: the incident from `source` as it stands, and what passes by,
   * around the eye. `night` 0..1 (the lamps' level) lights the glows;
   * `viewHeightPx` sizes the fireworks' sparks.
   */
  update(dt: number, camera: Camera, night: number, source: CityLifeSource, viewHeightPx: number): void {
    this.time += dt;
    this.sounds.sirenMeters = Number.POSITIVE_INFINITY;
    this.sounds.bursts = 0;
    this.sounds.burstMeters = Number.POSITIVE_INFINITY;
    const eye = camera.position;
    const incident = source.incident;
    this.showVehicles(source, eye, night);
    this.updateFire(dt, incident, source, eye, night);
    this.updateFireworks(dt, incident, eye, viewHeightPx);
    this.updatePlane(dt, eye, night);
    this.updateHelicopter(dt, incident, source, eye, night);
    this.updateShip(dt, eye, night);
    this.flames.update(dt, camera);
    this.smoke.update(dt, camera);
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    this.lambert.dispose();
    this.beaconMaterials[BLUE]!.dispose();
    this.beaconMaterials[RED]!.dispose();
    this.dimBeacon.dispose();
    for (const glows of [this.beaconGlows, this.fireGlow, this.planeLights, this.helicopterLight, this.shipLights]) {
      glows.dispose();
    }
    this.flames.dispose();
    this.smoke.dispose();
    this.fireworks.dispose();
  }

  private track<T extends BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  /** The incident's vehicles where it has them, their beacons flashing in turn. */
  private showVehicles(source: CityLifeSource, eye: Vector3, night: number): void {
    const kinds = source.vehicleKinds;
    let glows = 0;
    const flash = Math.floor(this.time * FLASH_HZ * 2) % 2;
    for (let slot = 0; slot < this.slots.length; slot++) {
      const kind = slot < kinds.length ? kinds[slot]! : null;
      const made = this.slots[slot]!;
      for (let k = 0; k < CITY_VEHICLE_KINDS.length; k++) {
        const other = made[CITY_VEHICLE_KINDS[k]!];
        if (other !== undefined && CITY_VEHICLE_KINDS[k] !== kind) {
          other.mesh.visible = false;
        }
      }
      if (kind === null) {
        continue;
      }
      const x = source.vehicleX[slot]!;
      const z = source.vehicleZ[slot]!;
      const dx = x - eye.x;
      const dz = z - eye.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      const shown = this.slotFor(slot, kind);
      shown.mesh.visible = distance < INCIDENT_DRAW_METERS;
      if (!shown.mesh.visible) {
        continue;
      }
      const heading = source.vehicleHeading[slot]!;
      shown.mesh.position.set(x, 0, z);
      shown.mesh.rotation.y = heading;
      if (kind !== 'getaway') {
        this.sounds.sirenMeters = Math.min(this.sounds.sirenMeters, distance);
      }
      const sin = Math.sin(heading);
      const cos = Math.cos(heading);
      const beacons = BEACONS[kind];
      for (let i = 0; i < beacons.length; i++) {
        // Left and right take turns; the second police car a half beat behind.
        const lit = (i + flash + slot) % 2 === 0;
        const beacon = beacons[i]!;
        shown.beacons[i]!.material = lit ? this.beaconMaterials[beacon[3]]! : this.dimBeacon;
        if (glows < MAX_BEACONS) {
          this.beaconGlows.setPosition(glows, x + beacon[0] * cos + beacon[2] * sin, beacon[1] + 0.1, z - beacon[0] * sin + beacon[2] * cos);
          this.beaconGlows.setColor(glows, lit ? beacon[3] : 0x000000);
          glows++;
        }
      }
    }
    this.beaconGlows.setCount(glows);
    this.beaconGlows.setLevel(glows > 0 ? 0.35 + 0.65 * night : 0);
  }

  private slotFor(slot: number, kind: CityVehicleKind): VehicleSlot {
    const slots = this.slots[slot]!;
    let shown = slots[kind];
    if (shown === undefined) {
      const body = VEHICLE_BODIES[kind];
      const mesh = new Mesh(this.track(paintedVehicle(body.type, body.paint, kind)), this.lambert);
      const beacons = BEACONS[kind].map(([x, y, z]) => {
        const beacon = new Mesh(this.track(new BoxGeometry(0.42, 0.16, 0.26)), this.dimBeacon);
        beacon.position.set(x, y, z);
        mesh.add(beacon);
        return beacon;
      });
      this.root.add(mesh);
      shown = { mesh, beacons };
      slots[kind] = shown;
    }
    return shown;
  }

  /** The fire: flames off the roof, smoke over the town, the fire engine's water on it, a glow at night. */
  private updateFire(dt: number, incident: CityIncident | null, source: CityLifeSource, eye: Vector3, night: number): void {
    if (incident === null || incident.kind !== 'building_fire') {
      this.fireGlow.setLevel(0);
      return;
    }
    const { x, z, halfWidthX, halfWidthZ, heightMeters, durationSeconds } = incident;
    const elapsed = source.elapsedSeconds;
    const dx = x - eye.x;
    const dz = z - eye.z;
    if (dx * dx + dz * dz > INCIDENT_DRAW_METERS * INCIDENT_DRAW_METERS) {
      this.fireGlow.setLevel(0);
      return;
    }
    // It takes hold over the first 10 s; the last 40 s it is being put out, and only smoke (steam) is left.
    const left = durationSeconds - elapsed;
    const blaze = Math.min(1, elapsed / 10) * Math.min(1, Math.max(0, (left - 20) / 20));
    const flicker = 0.8 + 0.2 * Math.sin(this.time * 13) * Math.sin(this.time * 7.3);
    this.fireGlow.setPosition(0, x, heightMeters + 2, z);
    this.fireGlow.setColor(0, 0xff8a2a);
    this.fireGlow.setCount(1);
    this.fireGlow.setLevel(blaze * flicker * (0.25 + 0.75 * night));
    const puff = this.puff;
    // Flames: about 70 a second at full blaze.
    for (let total = Math.floor(70 * dt * blaze + this.random.next()); total > 0; total--) {
      puff.x = x + this.random.range(-halfWidthX, halfWidthX) * 0.8;
      puff.z = z + this.random.range(-halfWidthZ, halfWidthZ) * 0.8;
      puff.y = heightMeters + this.random.range(-0.5, 0.5);
      puff.vx = this.random.range(-0.6, 0.6);
      puff.vz = this.random.range(-0.6, 0.6);
      puff.vy = this.random.range(2.5, 5);
      puff.startSizeMeters = this.random.range(2, 3.4);
      puff.endSizeMeters = 0.5;
      puff.lifeSeconds = this.random.range(0.5, 1.1);
      puff.color = this.random.next() < 0.5 ? 0xff8a1e : this.random.next() < 0.5 ? 0xffc04a : 0xff5a14;
      puff.opacity = 0.92;
      puff.lift = 2;
      puff.drag = 1;
      this.flames.spawn(puff);
    }
    // Smoke: thick and dark while it burns, pale as it is put out.
    const smokeRate = 9 * Math.max(blaze, 0.35 * Math.min(1, left / 20));
    for (let total = Math.floor(smokeRate * dt + this.random.next()); total > 0; total--) {
      puff.x = x + this.random.range(-halfWidthX, halfWidthX) * 0.6;
      puff.z = z + this.random.range(-halfWidthZ, halfWidthZ) * 0.6;
      puff.y = heightMeters + 2;
      puff.vx = 1.6 + this.random.range(-0.4, 0.4);
      puff.vz = 0.6 + this.random.range(-0.4, 0.4);
      puff.vy = this.random.range(2.5, 4);
      puff.startSizeMeters = this.random.range(4, 6);
      puff.endSizeMeters = this.random.range(14, 20);
      puff.lifeSeconds = this.random.range(7, 10);
      puff.color = blaze > 0.3 ? 0x34312e : 0x9a9894;
      puff.opacity = blaze > 0.3 ? 0.8 : 0.55;
      puff.lift = 0.6;
      puff.drag = 0.2;
      this.smoke.spawn(puff);
    }
    // The fire engine's water: an arc from its ladder onto the building, once it is set up.
    if (elapsed > 6 && left > 8 && source.vehicleKinds[0] === 'fire_engine') {
      const fromX = source.vehicleX[0]!;
      const fromZ = source.vehicleZ[0]!;
      const toX = x - fromX;
      const toZ = z - fromZ;
      const length = Math.sqrt(toX * toX + toZ * toZ) || 1;
      for (let total = Math.floor(22 * dt + this.random.next()); total > 0; total--) {
        puff.x = fromX;
        puff.z = fromZ;
        puff.y = 3.6;
        const speed = this.random.range(13, 16);
        puff.vx = (toX / length) * speed;
        puff.vz = (toZ / length) * speed;
        puff.vy = Math.min(14, 4 + heightMeters * 0.5) + this.random.range(-0.6, 0.6);
        puff.startSizeMeters = 0.5;
        puff.endSizeMeters = 2.2;
        puff.lifeSeconds = 1.4;
        puff.color = 0xe6eef4;
        puff.opacity = 0.6;
        puff.lift = -9.8;
        puff.drag = 0.3;
        this.smoke.spawn(puff);
      }
    }
  }

  /** The fireworks: shells climb and burst over the town in turn while the show lasts. */
  private updateFireworks(dt: number, incident: CityIncident | null, eye: Vector3, viewHeightPx: number): void {
    const fireworks = this.fireworks;
    const showing = incident !== null && incident.kind === 'fireworks';
    if (showing) {
      this.sinceFireworks -= dt;
      if (this.sinceFireworks <= 0) {
        this.sinceFireworks = this.random.range(0.45, 1.3);
        const x = incident.x + this.random.range(-70, 70);
        const z = incident.z + this.random.range(-70, 70);
        const y = this.random.range(55, 95);
        const color = FIREWORK_COLORS[this.random.int(0, FIREWORK_COLORS.length - 1)]!;
        if (fireworks.launch(this.time, x, y, z, color, this.random.range(38, 56))) {
          // Heard as it bursts (the sound's own delay comes from the distance).
          scratch.set(x - eye.x, y - eye.y, z - eye.z);
          this.sounds.bursts++;
          this.sounds.burstMeters = Math.min(this.sounds.burstMeters, scratch.length());
        }
      }
    }
    fireworks.update(this.time, viewHeightPx);
  }

  /** An airliner high over the region every few minutes, out of the haze and back into it. */
  private updatePlane(dt: number, eye: Vector3, night: number): void {
    if (this.planeAlong > PLANE_REACH * 2) {
      this.plane.visible = false;
      this.planeLights.setLevel(0);
      this.untilPlane -= dt;
      if (this.untilPlane > 0) {
        return;
      }
      this.untilPlane = this.random.range(PLANE_GAP_SECONDS[0], PLANE_GAP_SECONDS[1]);
      startPass(this.random, eye, this.random.range(PLANE_ALTITUDE[0], PLANE_ALTITUDE[1]), this.random.range(80, 450), this.planeFrom, this.planeDirection);
      this.planeAlong = 0;
    }
    this.planeAlong += PLANE_SPEED * dt;
    const plane = this.plane;
    plane.visible = true;
    plane.position.copy(this.planeFrom).addScaledVector(this.planeDirection, this.planeAlong);
    plane.rotation.set(0, Math.atan2(this.planeDirection.x, this.planeDirection.z), 0);
    const sin = Math.sin(plane.rotation.y);
    const cos = Math.cos(plane.rotation.y);
    const { x, y, z } = plane.position;
    // Wingtips red (left) and green (right); a white strobe on the tail, two flashes a second and a half.
    this.planeLights.setPosition(0, x + 16 * cos, y, z - 16 * sin);
    this.planeLights.setPosition(1, x - 16 * cos, y, z + 16 * sin);
    this.planeLights.setPosition(2, x - 17 * sin, y + 5, z - 17 * cos);
    this.planeLights.setColor(2, this.time % 1.5 < 0.1 ? 0xffffff : 0x000000);
    this.planeLights.setCount(3);
    this.planeLights.setLevel(0.3 + 0.7 * night);
  }

  /** The helicopter: over the incident while there is one (round the fire, after the chase), else a pass now and then. */
  private updateHelicopter(dt: number, incident: CityIncident | null, source: CityLifeSource, eye: Vector3, night: number): void {
    const helicopter = this.helicopter;
    this.rotor.rotation.y += dt * 28;
    if (incident !== null && incident.kind !== 'fireworks') {
      // Comes in from where it was and holds over the scene.
      let targetX = incident.x;
      let targetZ = incident.z;
      if (incident.kind === 'police_chase') {
        targetX = source.vehicleX[0]!;
        targetZ = source.vehicleZ[0]!;
      }
      this.orbitAngle += (dt * HELICOPTER_SPEED) / HELICOPTER_ORBIT;
      const wantX = targetX + Math.sin(this.orbitAngle) * HELICOPTER_ORBIT;
      const wantZ = targetZ + Math.cos(this.orbitAngle) * HELICOPTER_ORBIT;
      if (!helicopter.visible) {
        helicopter.position.set(wantX + 400, HELICOPTER_ALTITUDE + 30, wantZ + 400);
        helicopter.visible = true;
      }
      const step = Math.min(1, dt * 0.6);
      const fromX = helicopter.position.x;
      const fromZ = helicopter.position.z;
      helicopter.position.x += (wantX - fromX) * step;
      helicopter.position.z += (wantZ - fromZ) * step;
      helicopter.position.y += (HELICOPTER_ALTITUDE - helicopter.position.y) * step;
      if (Math.abs(wantX - fromX) + Math.abs(wantZ - fromZ) > 0.01) {
        helicopter.rotation.y = Math.atan2(wantX - fromX, wantZ - fromZ);
      }
      this.helicopterAlong = Number.POSITIVE_INFINITY;
    } else if (this.helicopterAlong <= PLANE_REACH * 2) {
      this.helicopterAlong += HELICOPTER_SPEED * dt;
      helicopter.position.copy(this.helicopterFrom).addScaledVector(this.helicopterDirection, this.helicopterAlong);
      helicopter.rotation.y = Math.atan2(this.helicopterDirection.x, this.helicopterDirection.z);
    } else {
      helicopter.visible = false;
      this.untilHelicopter -= dt;
      if (this.untilHelicopter <= 0) {
        this.untilHelicopter = this.random.range(HELICOPTER_GAP_SECONDS[0], HELICOPTER_GAP_SECONDS[1]);
        startPass(this.random, eye, 110, this.random.range(60, 300), this.helicopterFrom, this.helicopterDirection);
        this.helicopterAlong = 0;
        helicopter.visible = true;
      }
    }
    // A nose-down lean as it flies.
    helicopter.rotation.x = 0.12;
    this.helicopterLight.setPosition(0, helicopter.position.x, helicopter.position.y - 0.4, helicopter.position.z);
    this.helicopterLight.setColor(0, this.time % 1.2 < 0.15 ? 0xff3030 : 0x000000);
    this.helicopterLight.setCount(1);
    this.helicopterLight.setLevel(helicopter.visible ? 0.3 + 0.7 * night : 0);
  }

  /** A cargo ship out at sea, sailing the length of the coast and back, rising and falling on the swell. */
  private updateShip(dt: number, eye: Vector3, night: number): void {
    const ship = this.ship;
    const sea = this.sea;
    if (ship === null || sea === null) {
      return;
    }
    this.shipZ += this.shipDirection * SHIP_SPEED * dt;
    if (Math.abs(this.shipZ) > this.halfSizeMeters + 400) {
      this.shipDirection = -this.shipDirection;
      this.shipZ = Math.sign(this.shipZ) * (this.halfSizeMeters + 400);
    }
    const x = shorelineXAt(sea.shoreline, this.shipZ) - SHIP_OFFSHORE;
    const dx = x - eye.x;
    const dz = this.shipZ - eye.z;
    ship.visible = dx * dx + dz * dz < 1100 * 1100;
    if (!ship.visible) {
      this.shipLights.setLevel(0);
      return;
    }
    ship.position.set(x, Math.sin(this.time * 0.5) * 0.25, this.shipZ);
    ship.rotation.set(Math.sin(this.time * 0.37) * 0.01, this.shipDirection > 0 ? 0 : Math.PI, Math.sin(this.time * 0.41) * 0.015);
    const ahead = this.shipDirection;
    this.shipLights.setPosition(0, x, 24, this.shipZ + ahead * 10);
    // Port (red) on its left, +X facing +Z; starboard (green) on its right.
    this.shipLights.setPosition(1, x + ahead * 7, 9, this.shipZ - ahead * 30);
    this.shipLights.setPosition(2, x - ahead * 7, 9, this.shipZ - ahead * 30);
    this.shipLights.setCount(3);
    this.shipLights.setLevel(night);
  }
}

interface VehicleSlot {
  readonly mesh: Mesh;
  readonly beacons: Mesh[];
}

/** A straight pass `altitude` high that comes within `nearest` meters of `eye`, written into `from` and `direction`. */
function startPass(random: SeededRandom, eye: Vector3, altitude: number, nearest: number, from: Vector3, direction: Vector3): void {
  const angle = random.range(0, Math.PI * 2);
  direction.set(Math.sin(angle), 0, Math.cos(angle));
  const side = random.sign();
  // The point nearest the eye, then back along the way to where it comes out of the haze.
  from.set(eye.x + direction.z * nearest * side - direction.x * PLANE_REACH, altitude, eye.z - direction.x * nearest * side - direction.z * PLANE_REACH);
}

/** A traffic vehicle's definition for its shape alone. */
function trafficType(kind: TrafficVehicleDefinition['kind'], length: number, width: number, height: number, carBody?: 'saloon'): TrafficVehicleDefinition {
  return {
    id: `city_${kind}`,
    kind,
    ...(carBody === undefined ? {} : { carBody }),
    lengthMeters: length,
    widthMeters: width,
    heightMeters: height,
    cruiseSpeedFactor: 1,
    accelerationMetersPerSecondSquared: 1,
    spawnWeight: 0,
    colors: [0xffffff],
  };
}

/** A traffic body in `paint`, with what marks it out: the fire engine's ladder and stripe, the ambulance's and police car's stripes. */
function paintedVehicle(type: TrafficVehicleDefinition, paint: number, kind: CityVehicleKind): BufferGeometry {
  const body = vehicleGeometry(type);
  const painted = body.getAttribute('paint');
  const colors = body.getAttribute('color');
  const color = new Color(paint);
  for (let i = 0; i < colors.count; i++) {
    if (painted !== undefined && painted.getX(i) > 0.5) {
      colors.setXYZ(i, color.r, color.g, color.b);
    }
  }
  for (const name of Object.keys(body.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'color') {
      body.deleteAttribute(name);
    }
  }
  const parts: BufferGeometry[] = [body.index === null ? body : body.toNonIndexed()];
  if (parts[0] !== body) {
    body.dispose();
  }
  const { widthMeters: w, lengthMeters: l, heightMeters: h } = type;
  switch (kind) {
    case 'fire_engine':
      // A ladder along the roof, and a white stripe down each side.
      parts.push(box(0.9, 0.18, l * 0.8, 0, h + 0.12, -0.2, 0xc9ccd0));
      parts.push(box(w + 0.02, 0.16, l * 0.92, 0, h * 0.42, 0, 0xf2f2ee));
      break;
    case 'ambulance':
      parts.push(box(w + 0.02, 0.22, l * 0.94, 0, h * 0.45, 0, 0x2f7d3a));
      parts.push(box(w + 0.02, 0.1, l * 0.94, 0, h * 0.62, 0, 0xffd21f));
      break;
    case 'police':
      parts.push(box(w + 0.02, 0.18, l * 0.7, 0, h * 0.5, 0, 0x1f4fbf));
      parts.push(box(1.1, 0.1, 0.32, 0, h + 0.05, -0.2, 0x2a2d33));
      break;
    case 'getaway':
      break;
  }
  return merged(parts);
}

/** A box in one colour, without texture coordinates, not indexed (it merges with anything). */
function box(w: number, h: number, d: number, x: number, y: number, z: number, hex: number): BufferGeometry {
  const geometry = new BoxGeometry(w, h, d).translate(x, y, z);
  geometry.deleteAttribute('uv');
  return paint(geometry, hex);
}

function cylinder(radiusTop: number, radiusBottom: number, length: number, segments: number, hex: number): BufferGeometry {
  const geometry = new CylinderGeometry(radiusTop, radiusBottom, length, segments);
  geometry.deleteAttribute('uv');
  return paint(geometry, hex);
}

function paint(geometry: BufferGeometry, hex: number): BufferGeometry {
  const color = new Color(hex);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry.index === null ? geometry : geometry.toNonIndexed();
}

/** One mesh from `parts`, which are disposed. */
function merged(parts: BufferGeometry[]): BufferGeometry {
  const geometry = mergeGeometries(parts);
  for (const part of parts) {
    part.dispose();
  }
  return geometry;
}

/** An airliner, 36 m long, flying toward +Z: a white fuselage with a window line, grey wings and engines, a teal tail. */
function planeGeometry(): BufferGeometry {
  const fuselage = cylinder(1.9, 1.9, 30, 12, 0xf2f3f4).rotateX(Math.PI / 2);
  const nose = cylinder(0.3, 1.9, 4, 12, 0xf2f3f4).rotateX(Math.PI / 2).translate(0, 0, 17);
  const tail = cylinder(1.9, 0.5, 5, 12, 0xf2f3f4).rotateX(-Math.PI / 2).translate(0, 0.6, -17.5);
  return merged([
    fuselage,
    nose,
    tail,
    box(0.1, 0.35, 24, 1.88, 0.5, 0.5, 0x2a3440),
    box(0.1, 0.35, 24, -1.88, 0.5, 0.5, 0x2a3440),
    box(32, 0.45, 5, 0, -0.6, 1, 0xb8bec6),
    box(11, 0.3, 3, 0, 0.6, -17, 0xb8bec6),
    box(0.4, 6, 4.2, 0, 3.6, -17.4, 0x1f8a8a),
    cylinder(1, 1, 4, 10, 0x9aa2ab).rotateX(Math.PI / 2).translate(7, -1.6, 3),
    cylinder(1, 1, 4, 10, 0x9aa2ab).rotateX(Math.PI / 2).translate(-7, -1.6, 3),
  ]);
}

/** A helicopter facing +Z: a dark blue body with a white band, its tail boom and skids; its main rotor apart, to spin. */
function helicopterGeometry(): { readonly body: BufferGeometry; readonly rotor: BufferGeometry } {
  return {
    body: merged([
      box(2.1, 2, 4.4, 0, 1.4, 0.4, 0x1d3557),
      box(2.12, 0.3, 4.42, 0, 1.2, 0.4, 0xf1f1ee),
      box(1.7, 1.1, 1.2, 0, 1.75, 2.6, 0x8fb4c8),
      box(0.45, 0.45, 5.6, 0, 1.7, -4.4, 0x1d3557),
      box(0.15, 1.5, 0.9, 0, 2.3, -7, 0x1d3557),
      box(0.12, 0.12, 4, 0.9, 0.1, 0.4, 0x2a2d33),
      box(0.12, 0.12, 4, -0.9, 0.1, 0.4, 0x2a2d33),
      box(0.12, 0.6, 0.12, 0.9, 0.4, 1.4, 0x2a2d33),
      box(0.12, 0.6, 0.12, -0.9, 0.4, 1.4, 0x2a2d33),
      box(0.12, 0.6, 0.12, 0.9, 0.4, -0.6, 0x2a2d33),
      box(0.12, 0.6, 0.12, -0.9, 0.4, -0.6, 0x2a2d33),
      box(0.3, 0.3, 0.3, 0, 2.5, 0.2, 0x2a2d33),
    ]),
    rotor: merged([box(10, 0.06, 0.3, 0, 0, 0, 0x22252a), box(0.3, 0.06, 10, 0, 0, 0, 0x22252a)]),
  };
}

/** A cargo ship 92 m long facing +Z: a dark hull, a red waterline, rows of containers, the white bridge at the stern. */
function shipGeometry(): BufferGeometry {
  const parts = [
    box(14, 7, 80, 0, 1.5, 0, 0x26323d),
    box(9, 7, 10, 0, 1.5, 44, 0x26323d),
    box(14.05, 1, 80.05, 0, -1.4, 0, 0x8c2020),
    box(12, 9, 9, 0, 9.5, -32, 0xeeeeea),
    box(13, 1.2, 10, 0, 14.6, -32, 0xeeeeea),
    box(1.2, 6, 1.2, 0, 18, -34, 0x2a2d33),
    box(2.2, 3, 2.2, 0, 7.5, -38, 0xc23b22),
  ];
  const colors = [0xc0392b, 0x2e86c1, 0x27ae60, 0xd68910, 0x7d3c98, 0xa6acaf];
  let pick = 0;
  for (let row = 0; row < 6; row++) {
    for (let stack = 0; stack < 2; stack++) {
      for (let across = -1; across <= 1; across++) {
        parts.push(box(3.6, 2.5, 11, across * 4, 6.3 + stack * 2.6, -18 + row * 11.5, colors[pick++ % colors.length]!));
      }
    }
  }
  return merged(parts);
}

const FIREWORK_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uStart[${SHELLS}];
uniform vec3 uOrigin[${SHELLS}];
uniform vec3 uShellColor[${SHELLS}];
uniform float uSpeed[${SHELLS}];
uniform float uPixels;
attribute vec3 aDirection;
attribute float aShell;
attribute float aSpread;
varying vec3 vColor;
varying float vAlpha;
void main() {
  int shell = int(aShell + 0.5);
  float t = uTime - uStart[shell];
  vec3 origin = uOrigin[shell];
  vec3 position3;
  float size;
  vAlpha = 0.0;
  if (t < 0.0 || t > ${(RISE_SECONDS + BURST_SECONDS).toFixed(2)}) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  if (t < ${RISE_SECONDS.toFixed(2)}) {
    // The shell climbing: only the first spark of each, a gold trail point.
    if (aSpread > 0.999) {
      float rise = t / ${RISE_SECONDS.toFixed(2)};
      position3 = vec3(origin.x, origin.y * (1.0 - (1.0 - rise) * (1.0 - rise)), origin.z);
      vColor = vec3(1.0, 0.8, 0.45);
      vAlpha = 1.0;
      size = 2.6;
    } else {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
  } else {
    float b = t - ${RISE_SECONDS.toFixed(2)};
    float travel = (1.0 - exp(-1.6 * b)) / 1.6;
    position3 = origin + aDirection * uSpeed[shell] * aSpread * travel + vec3(0.0, -2.2 * b * b, 0.0);
    float fade = 1.0 - b / ${BURST_SECONDS.toFixed(2)};
    // Late in its life a spark twinkles.
    float twinkle = b > 1.2 ? step(0.35, fract(sin(aSpread * 913.0 + uTime * 23.0) * 43758.5)) : 1.0;
    vAlpha = fade * fade * twinkle;
    vColor = mix(vec3(1.0), uShellColor[shell], min(1.0, b * 3.0)) * 1.6;
    size = 3.2;
  }
  vec4 viewPosition = modelViewMatrix * vec4(position3, 1.0);
  gl_Position = projectionMatrix * viewPosition;
  // Never under two pixels: a far shell still sparkles.
  gl_PointSize = max(2.0, size * uPixels / max(1.0, -viewPosition.z));
}
`;

const FIREWORK_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vAlpha;
  gl_FragColor = vec4(vColor * a, a);
}
`;

/**
 * The fireworks: SHELLS shells of SPARKS sparks each, all in one Points
 * draw. Each shell's launch time, burst point, colour and burst speed are
 * uniforms; the sparks' flight is worked out in the vertex shader from the
 * time, so a launch writes four uniforms and nothing per spark. Hidden
 * while no shell is in the air.
 */
class Fireworks {
  readonly points: Points;
  private readonly geometry = new BufferGeometry();
  private readonly material: ShaderMaterial;
  private readonly starts: number[] = new Array<number>(SHELLS).fill(-1000);
  private readonly origins: Vector3[] = Array.from({ length: SHELLS }, () => new Vector3());
  private readonly colors: Color[] = Array.from({ length: SHELLS }, () => new Color());
  private readonly speeds: number[] = new Array<number>(SHELLS).fill(18);
  private next = 0;

  constructor() {
    const random = new SeededRandom(1729);
    const count = SHELLS * SPARKS;
    const directions = new Float32Array(count * 3);
    const shells = new Float32Array(count);
    const spreads = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // Evenly over a sphere.
      const y = random.range(-1, 1);
      const angle = random.range(0, Math.PI * 2);
      const ring = Math.sqrt(1 - y * y);
      directions.set([ring * Math.sin(angle), y, ring * Math.cos(angle)], i * 3);
      shells[i] = Math.floor(i / SPARKS);
      // The first spark of each shell flies the full way (and shows the climb); the others a little less.
      spreads[i] = i % SPARKS === 0 ? 1 : random.range(0.75, 0.99);
    }
    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    this.geometry.setAttribute('aDirection', new BufferAttribute(directions, 3));
    this.geometry.setAttribute('aShell', new BufferAttribute(shells, 1));
    this.geometry.setAttribute('aSpread', new BufferAttribute(spreads, 1));
    this.material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uStart: { value: this.starts },
        uOrigin: { value: this.origins },
        uShellColor: { value: this.colors },
        uSpeed: { value: this.speeds },
        uPixels: { value: 600 },
      },
      vertexShader: FIREWORK_VERTEX,
      fragmentShader: FIREWORK_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    });
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  /** Launches a shell from the ground under (x, z) to burst `y` high in `color`: false when every shell is still in the air. */
  launch(time: number, x: number, y: number, z: number, color: number, speed: number): boolean {
    const shell = this.next;
    if (time - this.starts[shell]! < RISE_SECONDS + BURST_SECONDS) {
      return false;
    }
    this.next = (shell + 1) % SHELLS;
    this.starts[shell] = time;
    this.origins[shell]!.set(x, y, z);
    this.colors[shell]!.setHex(color);
    this.speeds[shell] = speed;
    return true;
  }

  update(time: number, viewHeightPx: number): void {
    let flying = false;
    for (let shell = 0; shell < SHELLS; shell++) {
      flying ||= time - this.starts[shell]! < RISE_SECONDS + BURST_SECONDS;
    }
    this.points.visible = flying;
    this.material.uniforms['uTime']!.value = time;
    this.material.uniforms['uPixels']!.value = viewHeightPx;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
