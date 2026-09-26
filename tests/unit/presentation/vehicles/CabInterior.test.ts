import { Color, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { VEHICLES } from '../../../../src/data/content/vehicles';
import { VehicleDynamics } from '../../../../src/domain/vehicles/VehicleDynamics';
import type { VehicleRuntimeState } from '../../../../src/domain/vehicles/VehicleRuntimeState';
import { CLUSTER_DIALS, dialAngle } from '../../../../src/presentation/textures/cabImages';
import { CabInterior, STEERING_RATIO, type DashboardReadings } from '../../../../src/presentation/vehicles/CabInterior';
import { cabGeometry } from '../../../../src/presentation/vehicles/cabGeometry';
import type { SceneLight } from '../../../../src/presentation/world/EnvironmentView';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

const truck = VEHICLES[0]!;
const STEP = 1 / 60;

/** The seven segments 'abcdefg' of each figure, lit (1) or dark (0), as a seven-segment display shows them. */
const FIGURES: Readonly<Record<string, string>> = {
  '0': '1111110',
  '1': '0110000',
  '2': '1101101',
  '3': '1111001',
  '5': '1011011',
  '7': '1110000',
  r: '0000101',
  n: '0010101',
};

function setup(): { cab: CabInterior; state: VehicleRuntimeState; readings: { -readonly [K in keyof DashboardReadings]: DashboardReadings[K] } } {
  const cab = new CabInterior(truck, cabGeometry(truck.body));
  const state = new VehicleDynamics(truck).createState(0, 0, 0);
  state.engineRpm = truck.powertrain.idleRpm;
  const readings = { fuelFraction: 1, clockMinutes: 600, drivePedal: 0, brakePedal: 0 };
  cab.setDashboard(readings);
  return { cab, state, readings };
}

function run(cab: CabInterior, state: VehicleRuntimeState, seconds: number, light?: SceneLight): void {
  for (let step = 0; step < Math.round(seconds / STEP); step++) {
    cab.update(state, STEP, 0, light);
  }
}

/** A scene's light: the key light from `keyDirection`, a clear day's sky. */
function sceneLight(keyDirection: Vector3): SceneLight {
  return { keyDirection: keyDirection.clone().normalize(), key: new Color(2.6, 2.4, 2.1), sky: new Color(0.8, 0.95, 1.15), ground: new Color(0.12, 0.1, 0.05) };
}

describe('CabInterior', () => {
  it('points each needle at what it shows, easing to it as a gauge does', () => {
    const { cab, state, readings } = setup();
    state.speed = 50 / 3.6;
    state.engineRpm = 1500;
    cab.setDashboard({ ...readings, fuelFraction: 0.25 });

    cab.update(state, STEP, 0);
    const firstFrame = cab.needleAngles[1]!;
    const target = dialAngle(CLUSTER_DIALS.speedometer, 50);
    // Under way, not there yet.
    expect(firstFrame).toBeLessThan(dialAngle(CLUSTER_DIALS.speedometer, 0));
    expect(firstFrame).toBeGreaterThan(target);

    run(cab, state, 3);
    expect(cab.needleAngles[0]).toBeCloseTo(dialAngle(CLUSTER_DIALS.tachometer, 1500), 3);
    expect(cab.needleAngles[1]).toBeCloseTo(target, 3);
    expect(cab.needleAngles[4]).toBeCloseTo(dialAngle(CLUSTER_DIALS.fuel, 0.25), 3);

    // Backing up, the speedometer reads the speed all the same.
    state.speed = -10 / 3.6;
    run(cab, state, 3);
    expect(cab.needleAngles[1]).toBeCloseTo(dialAngle(CLUSTER_DIALS.speedometer, 10), 3);
  });

  it('shows the time of day and the gear on its display, and blinks the colon', () => {
    const { cab, state, readings } = setup();
    cab.setDashboard({ ...readings, clockMinutes: 7 * 60 + 5.8 });
    state.gear = 3;
    cab.update(state, STEP, 0);
    expect(cab.litSegments.slice(0, 35)).toBe(FIGURES['0']! + FIGURES['7']! + FIGURES['0']! + FIGURES['5']! + FIGURES['3']!);

    state.gear = -1;
    cab.update(state, STEP, 0);
    expect(cab.litSegments.slice(28, 35)).toBe(FIGURES.r);

    const colons = new Set<string>();
    for (let step = 0; step < 90; step++) {
      cab.update(state, STEP, 0);
      colons.add(cab.litSegments.slice(35));
    }
    expect(colons).toEqual(new Set(['11', '00']));
  });

  it('uses the brakes\' air while braking and pumps it back while the engine runs, the second circuit a little lower', () => {
    const { cab, state, readings } = setup();
    state.engineRpm = 900;
    state.speed = 10;
    run(cab, state, 2);
    const full = cab.needleAngles[2]!;
    expect(cab.needleAngles[3]).toBeGreaterThan(full);

    cab.setDashboard({ ...readings, brakePedal: 1 });
    run(cab, state, 4);
    // Less pressure: the needle turns back toward 0 (a larger angle).
    expect(cab.needleAngles[2]).toBeGreaterThan(full + 0.3);

    cab.setDashboard({ ...readings, brakePedal: 0 });
    run(cab, state, 20);
    expect(cab.needleAngles[2]).toBeCloseTo(full, 1);
  });

  it('swings its charm forward when the truck brakes, outward in a turn, and lets it settle', () => {
    const { cab, state } = setup();
    state.longitudinalAcceleration = -6;
    run(cab, state, 0.25);
    expect(cab.charmSwing.ahead).toBeGreaterThan(0.05);

    state.longitudinalAcceleration = 0;
    state.lateralAcceleration = 3; // Turning left: it swings out to the right.
    run(cab, state, 0.25);
    expect(cab.charmSwing.left).toBeLessThan(-0.03);

    state.lateralAcceleration = 0;
    state.speed = 0;
    run(cab, state, 30);
    expect(Math.abs(cab.charmSwing.ahead)).toBeLessThan(0.01);
    expect(Math.abs(cab.charmSwing.left)).toBeLessThan(0.01);
  });

  it('turns the steering wheel with the front wheels, over a turn to full lock', () => {
    const { cab, state } = setup();
    state.steerAngle = (truck.handling.maxSteerAngleDegrees * Math.PI) / 180;
    cab.update(state, STEP, 0);

    const wheel = cab.root.getObjectByName('steering-wheel')!;
    expect(wheel.rotation.z).toBeCloseTo(state.steerAngle * STEERING_RATIO, 12);
    expect(wheel.rotation.z).toBeGreaterThan(2 * Math.PI);
  });

  it('lets the sun in only through the glass, and glows at night', () => {
    const { cab, state } = setup();
    const key = (): number => cab.light.cabinKey.value.r;

    // Heading 0 faces +z: the sun low ahead shines in; from behind or straight overhead it does not.
    run(cab, state, STEP, sceneLight(new Vector3(0, 0.4, 1)));
    expect(key()).toBeGreaterThan(0.5);
    const daySky = cab.light.cabinSky.value.g;
    run(cab, state, STEP, sceneLight(new Vector3(0, 0.4, -1)));
    expect(key()).toBe(0);
    run(cab, state, STEP, sceneLight(new Vector3(0.01, 1, 0)));
    expect(key()).toBe(0);
    // Low from the left (+x), through the driver's window.
    run(cab, state, STEP, sceneLight(new Vector3(1, 0.3, 0)));
    expect(key()).toBeGreaterThan(0.3);

    const dayGlow = cab.light.cabinGlow.value.r;
    cab.setLamps(1);
    run(cab, state, STEP, sceneLight(new Vector3(0, 0.4, 1)));
    expect(cab.light.cabinGlow.value.r).toBeGreaterThan(dayGlow * 2);
    expect(cab.light.cabinFill.value.r).toBeGreaterThan(0);
    // In the dark the eye has nothing to adapt from: the same sky lights the cab less.
    expect(cab.light.cabinSky.value.g).toBeLessThan(daySky / 2);
  });

  it('shows the minimap on its navigation screen, uploading only a new picture, and anew at a new size', () => {
    const { cab } = setup();
    const screen = cab.root.getObjectByName('cab-navigation') as Mesh;
    const texture = (screen.material as MeshBasicMaterial).map!;
    const disposals: number[] = [];
    texture.addEventListener('dispose', () => disposals.push(texture.version));
    const picture = { width: 240, height: 240 };
    const before = texture.version;

    cab.setNavigation(picture, 1);
    expect(texture.image).toBe(picture);
    expect(texture.version).toBe(before + 1);
    cab.setNavigation(picture, 1);
    expect(texture.version).toBe(before + 1);
    // Nothing to show yet: an empty canvas is not uploaded.
    cab.setNavigation({ width: 0, height: 0 }, 2);
    expect(texture.version).toBe(before + 1);

    cab.setNavigation(picture, 3);
    expect(texture.version).toBe(before + 2);
    expect(disposals).toHaveLength(1);
    cab.setNavigation({ width: 300, height: 300 }, 4);
    expect(disposals).toHaveLength(2);
  });

  it('draws in a handful of calls: its parts share one atlas, but for the screen and the mirrors', () => {
    const { cab } = setup();
    expect(drawCallCount(cab.root)).toBeLessThanOrEqual(9);
    const atlasMaterials = new Set<unknown>();
    cab.root.traverse((object) => {
      if (object instanceof Mesh && object.name !== 'cab-navigation' && object.name !== 'cab-mirror') {
        atlasMaterials.add(object.material);
      }
    });
    expect(atlasMaterials.size).toBe(1);
  });

  it('releases every GPU resource on dispose', () => {
    const { cab } = setup();
    const resources = gpuResources(cab.root);
    const disposed = watchDisposal(resources);

    cab.dispose();

    expect([...resources].filter((resource) => !disposed.has(resource))).toEqual([]);
  });
});
