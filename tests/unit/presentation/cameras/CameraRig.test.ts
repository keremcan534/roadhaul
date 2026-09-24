import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CAMERA_MODES } from '../../../../src/data/config/controls';
import { VEHICLES } from '../../../../src/data/content/vehicles';
import { CameraRig, SHOWCASE_PART_ANGLES, type CameraMotion } from '../../../../src/presentation/cameras/CameraRig';
import { cabGeometry } from '../../../../src/presentation/vehicles/cabGeometry';

const body = VEHICLES[0]!.body;
const cab = cabGeometry(body);
const AT_REST: CameraMotion = { speed: 0, steerAngle: 0, longitudinalAcceleration: 0, lateralAcceleration: 0 };

/** Camera position relative to the truck's rear axle, in the truck's frame (x = left, z = forward). */
function inTruckFrame(camera: PerspectiveCamera, pose: { x: number; z: number; heading: number }): Vector3 {
  const dx = camera.position.x - pose.x;
  const dz = camera.position.z - pose.z;
  const sin = Math.sin(pose.heading);
  const cos = Math.cos(pose.heading);
  return new Vector3(dx * cos - dz * sin, camera.position.y, dx * sin + dz * cos);
}

/** Where the camera looks, in the truck's frame: x = left, y = up, z = forward. */
function viewInTruckFrame(camera: PerspectiveCamera, heading: number): Vector3 {
  const view = camera.getWorldDirection(new Vector3());
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  return new Vector3(view.x * cos - view.z * sin, view.y, view.x * sin + view.z * cos);
}

function rigIn(mode: (typeof CAMERA_MODES)[number]): { camera: PerspectiveCamera; rig: CameraRig } {
  const camera = new PerspectiveCamera();
  const rig = new CameraRig(camera, body);
  rig.currentMode = mode;
  return { camera, rig };
}

describe('CameraRig', () => {
  it('starts as a chase camera behind and above the truck, looking the way it faces', () => {
    const camera = new PerspectiveCamera();
    const rig = new CameraRig(camera, body);
    const pose = { x: 30, z: -40, heading: 0.7 };

    rig.update(pose, AT_REST, 1 / 60);

    const local = inTruckFrame(camera, pose);
    expect(rig.currentMode).toBe('chase');
    expect(local.z).toBeLessThan(-5);
    expect(Math.abs(local.x)).toBeLessThan(1e-9);
    expect(local.y).toBeGreaterThan(body.heightMeters);
    expect(viewInTruckFrame(camera, pose.heading).z).toBeGreaterThan(0.9);
  });

  it('trails smoothly instead of jumping when the truck moves', () => {
    const camera = new PerspectiveCamera();
    const rig = new CameraRig(camera, body);
    rig.update({ x: 0, z: 0, heading: 0 }, AT_REST, 1 / 60);
    const before = camera.position.clone();

    rig.update({ x: 0, z: 10, heading: 0 }, { ...AT_REST, speed: 20 }, 1 / 60);

    const moved = camera.position.z - before.z;
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(10);
  });

  it('steps through every camera with the button, round to the chase camera', () => {
    const camera = new PerspectiveCamera();
    const rig = new CameraRig(camera, body);
    const seen = [rig.currentMode];
    for (let press = 0; press < CAMERA_MODES.length; press++) {
      seen.push(rig.toggleMode());
    }
    expect(seen).toEqual([...CAMERA_MODES, 'chase']);
  });

  it('puts the cabin camera at the driver seat, with a wider view', () => {
    const { camera, rig } = rigIn('cabin');
    const pose = { x: 0, z: 0, heading: 0 };
    rig.update(pose, AT_REST, 1 / 60);

    const local = inTruckFrame(camera, pose);
    expect(local.x).toBeCloseTo(cab.eyeX, 9);
    expect(local.y).toBeCloseTo(cab.eyeY, 9);
    expect(local.z).toBeCloseTo(cab.eyeZ, 9);
    expect(local.x).toBeLessThan(body.widthMeters / 2);
    expect(local.z).toBeLessThan(cab.frontZ);
    expect(camera.fov).toBeGreaterThan(65);
    expect(viewInTruckFrame(camera, pose.heading).z).toBeGreaterThan(0.99);
  });

  it('has the cabin camera look into bends, and the head sway with braking and cornering', () => {
    const { camera, rig } = rigIn('cabin');
    const pose = { x: 5, z: 8, heading: -0.4 };
    // A right turn under braking: the front wheels point right, the truck pulls right and slows.
    const turning: CameraMotion = { speed: 12, steerAngle: 0.3, longitudinalAcceleration: -4, lateralAcceleration: -3 };
    for (let frame = 0; frame < 120; frame++) {
      rig.update(pose, turning, 1 / 60);
    }
    const view = viewInTruckFrame(camera, pose.heading);
    expect(view.x).toBeLessThan(-0.05); // Looking right.
    const local = inTruckFrame(camera, pose);
    expect(local.x).toBeGreaterThan(cab.eyeX); // Leaning out of the turn, to the left.
    expect(local.z).toBeGreaterThan(cab.eyeZ); // Pitched forward by the braking.
    expect(Math.hypot(local.x - cab.eyeX, local.z - cab.eyeZ)).toBeLessThan(0.1);

    for (let frame = 0; frame < 240; frame++) {
      rig.update(pose, AT_REST, 1 / 60);
    }
    expect(inTruckFrame(camera, pose).x).toBeCloseTo(cab.eyeX, 3);
    expect(Math.abs(viewInTruckFrame(camera, pose.heading).x)).toBeLessThan(1e-3);
  });

  it('puts the hood camera on the cab roof, looking ahead', () => {
    const { camera, rig } = rigIn('hood');
    const pose = { x: -20, z: 3, heading: 2 };
    rig.update(pose, AT_REST, 1 / 60);
    const local = inTruckFrame(camera, pose);
    expect(Math.abs(local.x)).toBeLessThan(1e-9);
    expect(local.y).toBeGreaterThan(cab.cabTop);
    expect(local.z).toBeGreaterThan(cab.frontZ - 1);
    expect(local.z).toBeLessThan(cab.frontZ);
    expect(viewInTruckFrame(camera, pose.heading).z).toBeGreaterThan(0.99);
  });

  it('puts the rear camera behind the body, looking down at the road behind', () => {
    const { camera, rig } = rigIn('rear');
    const pose = { x: 7, z: -9, heading: 1 };
    rig.update(pose, AT_REST, 1 / 60);
    const local = inTruckFrame(camera, pose);
    expect(local.z).toBeLessThan(cab.rearZ);
    expect(local.y).toBeLessThan(body.heightMeters);
    const view = viewInTruckFrame(camera, pose.heading);
    expect(view.z).toBeLessThan(-0.8);
    expect(view.y).toBeLessThan(-0.3);
    expect(camera.fov).toBeGreaterThan(75);
  });

  it('looks down on the truck from high above in the top view', () => {
    const { camera, rig } = rigIn('top');
    const pose = { x: 100, z: 50, heading: -1 };
    rig.update(pose, AT_REST, 1 / 60);
    expect(camera.position.y).toBeGreaterThan(25);
    expect(viewInTruckFrame(camera, pose.heading).y).toBeLessThan(-0.85);
  });

  it('turns every camera by the drag, within its limits', () => {
    const pose = { x: 0, z: 0, heading: 0.3 };
    // The first-person cameras turn their view right.
    for (const mode of ['cabin', 'hood'] as const) {
      const { camera, rig } = rigIn(mode);
      rig.look(0.6, 0.2);
      rig.update(pose, AT_REST, 1 / 60);
      const view = viewInTruckFrame(camera, pose.heading);
      expect(view.x, mode).toBeLessThan(-0.4);
      expect(view.y, mode).toBeGreaterThan(0.05);
    }
    // The chase camera swings round the truck to the left, so it looks right across it.
    const { camera, rig } = rigIn('chase');
    rig.look(Math.PI / 2, 0);
    rig.update(pose, AT_REST, 1 / 60);
    expect(inTruckFrame(camera, pose).x).toBeGreaterThan(5);
    expect(viewInTruckFrame(camera, pose.heading).x).toBeLessThan(-0.9);

    // Beyond its limits a camera stops turning.
    const limited = rigIn('rear');
    const [maxYaw] = limited.rig.lookLimits;
    limited.rig.look(10, 0);
    limited.rig.update(pose, AT_REST, 1 / 60);
    const atLimit = viewInTruckFrame(limited.camera, pose.heading);
    limited.rig.look(maxYaw, 0);
    limited.rig.update(pose, AT_REST, 1 / 60);
    expect(viewInTruckFrame(limited.camera, pose.heading).x).toBeCloseTo(atLimit.x, 9);
  });

  it('circles the parked truck behind the menus, looking at it, and returns to the driving camera after', () => {
    const camera = new PerspectiveCamera();
    const rig = new CameraRig(camera, body);
    const pose = { x: 30, z: -40, heading: 0.7 };
    const centre = new Vector3(
      pose.x + Math.sin(pose.heading) * (body.wheelbaseMeters / 2),
      0,
      pose.z + Math.cos(pose.heading) * (body.wheelbaseMeters / 2),
    );
    rig.toggleMode(); // Cabin view while driving.

    rig.showcase = true;
    const angles: number[] = [];
    for (let i = 0; i < 3; i++) {
      rig.update(pose, AT_REST, 2);
      const dx = camera.position.x - centre.x;
      const dz = camera.position.z - centre.z;
      expect(Math.hypot(dx, dz)).toBeCloseTo(14, 6);
      expect(camera.fov).toBe(60);
      const view = camera.getWorldDirection(new Vector3());
      expect(view.x * -dx + view.z * -dz).toBeGreaterThan(0); // Looking back at the truck.
      angles.push(Math.atan2(dx, dz));
    }
    expect(new Set(angles.map((angle) => angle.toFixed(3))).size).toBe(3); // It moves round.

    rig.showcase = false;
    rig.update(pose, AT_REST, 1 / 60);
    expect(rig.currentMode).toBe('cabin');
    expect(camera.fov).toBe(72);
  });

  it('frames the showcase beside a panel: the truck in the middle of the free part, from further back', () => {
    const camera = new PerspectiveCamera(60, 2.4);
    const rig = new CameraRig(camera, body);
    const pose = { x: 0, z: 0, heading: 0 };
    // Where the showcase looks: the middle of the truck, a little above the ground.
    const target = (): Vector3 => {
      camera.updateMatrixWorld();
      return new Vector3(0, 1.8, cab.centreZ).project(camera);
    };
    const distance = (): number => Math.hypot(camera.position.x, camera.position.z - cab.centreZ);
    rig.showcase = true;
    rig.update(pose, AT_REST, 0);
    const whole = distance();
    expect(target().x).toBeCloseTo(0, 6);

    // A panel over the right 70% (a phone on its side): the truck sits in the middle of the left 30%.
    rig.frameBeside(0.7, 0);
    rig.update(pose, AT_REST, 0);
    expect(target().x).toBeCloseTo(-0.7, 3);
    expect(target().y).toBeCloseTo(0, 3);
    expect(distance()).toBeGreaterThan(whole);
    // Over the bottom 60% (upright): the truck sits in the middle of the top 40%.
    rig.frameBeside(0, 0.6);
    rig.update(pose, AT_REST, 0);
    expect(target().x).toBeCloseTo(0, 3);
    expect(target().y).toBeCloseTo(0.6, 3);
    expect(camera.aspect).toBeCloseTo(2.4, 9);

    rig.frameBeside(0, 0);
    rig.update(pose, AT_REST, 0);
    expect(camera.view?.enabled ?? false).toBe(false);
    expect(target().x).toBeCloseTo(0, 6);
    expect(distance()).toBeCloseTo(whole, 6);
  });

  it('swings the showcase round to a part it is asked to show, the short way, then circles on', () => {
    const camera = new PerspectiveCamera();
    const rig = new CameraRig(camera, body);
    const pose = { x: 0, z: 0, heading: 0 };
    const around = (): number => Math.atan2(camera.position.x, camera.position.z - cab.centreZ);
    rig.showcase = true;
    rig.update(pose, AT_REST, 0);

    const exhaust = SHOWCASE_PART_ANGLES.exhaust;
    rig.turnShowcaseTo(exhaust);
    let closest = Infinity;
    for (let frame = 0; frame < 150; frame++) {
      rig.update(pose, AT_REST, 1 / 30);
      closest = Math.min(closest, Math.abs(Math.atan2(Math.sin(around() - exhaust), Math.cos(around() - exhaust))));
    }
    expect(closest).toBeLessThan(0.02);
    // It goes on round from there.
    const reached = around();
    rig.update(pose, AT_REST, 1);
    expect(around()).not.toBeCloseTo(reached, 3);
  });

  it('widens the view ahead at speed, easing into it and back, but not the rear or top cameras\' views', () => {
    const pose = { x: 0, z: 0, heading: 0 };
    const fast: CameraMotion = { ...AT_REST, speed: 25 };
    for (const [mode, base] of [
      ['chase', 60],
      ['cabin', 72],
      ['hood', 70],
    ] as const) {
      const { camera, rig } = rigIn(mode);
      rig.update(pose, AT_REST, 1 / 60);
      expect(camera.fov).toBe(base);
      rig.update(pose, fast, 1 / 60);
      const easing = camera.fov;
      expect(easing).toBeGreaterThan(base);
      expect(easing).toBeLessThan(base + 1);
      for (let i = 0; i < 600; i++) {
        rig.update(pose, fast, 1 / 60);
      }
      expect(camera.fov).toBeCloseTo(base + 6, 1);
      for (let i = 0; i < 600; i++) {
        rig.update(pose, AT_REST, 1 / 60);
      }
      expect(camera.fov).toBeCloseTo(base, 1);
    }
    for (const [mode, base] of [
      ['rear', 80],
      ['top', 55],
    ] as const) {
      const { camera, rig } = rigIn(mode);
      for (let i = 0; i < 60; i++) {
        rig.update(pose, fast, 1 / 60);
      }
      expect(camera.fov).toBe(base);
    }
  });

  it('follows a truck swapped in from the same gap behind its tail, and above its roof', () => {
    const camera = new PerspectiveCamera();
    const pose = { x: 0, z: 0, heading: 0 };
    const rig = new CameraRig(camera, body);
    /** How far behind the back of the body the camera is. */
    const gapBehindTail = (truck: typeof body): number =>
      -inTruckFrame(camera, pose).z - (truck.lengthMeters / 2 - truck.wheelbaseMeters / 2);
    rig.update(pose, AT_REST, 1 / 60);
    const gap = gapBehindTail(body);

    for (const truck of VEHICLES.slice(1).map((vehicle) => vehicle.body)) {
      rig.setBody(truck);
      rig.update(pose, AT_REST, 1 / 60); // Snaps: no swing across the map.
      expect(gapBehindTail(truck)).toBeCloseTo(gap, 9);
      expect(camera.position.y).toBeGreaterThan(truck.heightMeters + 1);
    }
  });
});
