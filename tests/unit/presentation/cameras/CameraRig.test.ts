import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { VEHICLES } from '../../../../src/data/content/vehicles';
import { CameraRig } from '../../../../src/presentation/cameras/CameraRig';

const body = VEHICLES[0]!.body;

/** Camera position relative to the truck's rear axle, in the truck's frame (x = left, z = forward). */
function inTruckFrame(camera: PerspectiveCamera, pose: { x: number; z: number; heading: number }): Vector3 {
  const dx = camera.position.x - pose.x;
  const dz = camera.position.z - pose.z;
  const sin = Math.sin(pose.heading);
  const cos = Math.cos(pose.heading);
  return new Vector3(dx * cos - dz * sin, camera.position.y, dx * sin + dz * cos);
}

describe('CameraRig', () => {
  it('starts as a chase camera behind and above the truck, looking the way it faces', () => {
    const camera = new PerspectiveCamera();
    const rig = new CameraRig(camera, body);
    const pose = { x: 30, z: -40, heading: 0.7 };

    rig.update(pose, 0, 1 / 60);

    const local = inTruckFrame(camera, pose);
    expect(rig.currentMode).toBe('chase');
    expect(local.z).toBeLessThan(-5);
    expect(Math.abs(local.x)).toBeLessThan(1e-9);
    expect(local.y).toBeGreaterThan(body.heightMeters);
    const view = camera.getWorldDirection(new Vector3());
    expect(view.x * Math.sin(pose.heading) + view.z * Math.cos(pose.heading)).toBeGreaterThan(0.9);
  });

  it('trails smoothly instead of jumping when the truck moves', () => {
    const camera = new PerspectiveCamera();
    const rig = new CameraRig(camera, body);
    rig.update({ x: 0, z: 0, heading: 0 }, 0, 1 / 60);
    const before = camera.position.clone();

    rig.update({ x: 0, z: 10, heading: 0 }, 20, 1 / 60);

    const moved = camera.position.z - before.z;
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(10);
  });

  it('switches to a cabin camera at the driver seat, with a wider view', () => {
    const camera = new PerspectiveCamera();
    const rig = new CameraRig(camera, body);
    const pose = { x: 0, z: 0, heading: 0 };

    expect(rig.toggleMode()).toBe('cabin');
    rig.update(pose, 0, 1 / 60);

    const local = inTruckFrame(camera, pose);
    expect(local.x).toBeGreaterThan(0);
    expect(local.x).toBeLessThan(body.widthMeters / 2);
    expect(local.z).toBeGreaterThan(body.wheelbaseMeters / 2);
    expect(local.z).toBeLessThan(body.wheelbaseMeters / 2 + body.lengthMeters / 2);
    expect(camera.fov).toBeGreaterThan(65);

    expect(rig.toggleMode()).toBe('chase');
    expect(camera.fov).toBeLessThan(65);
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
      rig.update(pose, 0, 2);
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
    rig.update(pose, 0, 1 / 60);
    expect(rig.currentMode).toBe('cabin');
    expect(camera.fov).toBe(72);
  });

  it('follows a truck swapped in from the same gap behind its tail, and above its roof', () => {
    const camera = new PerspectiveCamera();
    const pose = { x: 0, z: 0, heading: 0 };
    const rig = new CameraRig(camera, body);
    /** How far behind the back of the body the camera is. */
    const gapBehindTail = (truck: typeof body): number =>
      -inTruckFrame(camera, pose).z - (truck.lengthMeters / 2 - truck.wheelbaseMeters / 2);
    rig.update(pose, 0, 1 / 60);
    const gap = gapBehindTail(body);

    for (const truck of VEHICLES.slice(1).map((vehicle) => vehicle.body)) {
      rig.setBody(truck);
      rig.update(pose, 0, 1 / 60); // Snaps: no swing across the map.
      expect(gapBehindTail(truck)).toBeCloseTo(gap, 9);
      expect(camera.position.y).toBeGreaterThan(truck.heightMeters + 1);
    }
  });
});
