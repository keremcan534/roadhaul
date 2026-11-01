import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { VEHICLES } from '../../../../src/data/content/vehicles';
import { CameraRig } from '../../../../src/presentation/cameras/CameraRig';
import { PHOTO_FIELD_OF_VIEW, PhotoCamera } from '../../../../src/presentation/cameras/PhotoCamera';

const body = VEHICLES[0]!.body;
const pose = { x: 120, z: -40, heading: 0.7 };
/** The truck's middle, where the photo camera looks. */
const middle = new Vector3(pose.x + Math.sin(pose.heading) * (body.wheelbaseMeters / 2), 1.8, pose.z + Math.cos(pose.heading) * (body.wheelbaseMeters / 2));

function lookingAtMiddle(camera: PerspectiveCamera): number {
  const view = camera.getWorldDirection(new Vector3());
  const towards = middle.clone().sub(camera.position).normalize();
  return view.dot(towards);
}

describe('PhotoCamera', () => {
  it('takes over from the chase camera where it stands, looking at the truck', () => {
    const camera = new PerspectiveCamera();
    const rig = new CameraRig(camera, body);
    rig.update(pose, { speed: 0, steerAngle: 0, pathCurvature: 0, longitudinalAcceleration: 0, lateralAcceleration: 0 }, 1 / 60);
    const before = camera.position.clone();

    const photo = new PhotoCamera(body);
    photo.start(camera, pose);
    photo.apply(camera, pose);

    expect(camera.position.distanceTo(before)).toBeLessThan(0.01);
    expect(lookingAtMiddle(camera)).toBeCloseTo(1, 6);
    expect(camera.fov).toBe(PHOTO_FIELD_OF_VIEW);
  });

  it('steps out behind the truck when opened from inside the cab', () => {
    const camera = new PerspectiveCamera();
    camera.position.copy(middle);
    const photo = new PhotoCamera(body);

    photo.start(camera, pose);
    photo.apply(camera, pose);

    const behind = -(Math.sin(pose.heading) * (camera.position.x - middle.x) + Math.cos(pose.heading) * (camera.position.z - middle.z));
    expect(behind).toBeGreaterThan(10);
    expect(lookingAtMiddle(camera)).toBeCloseTo(1, 6);
  });

  it('circles the truck at the same distance as it is dragged, and looks down from above dragged down', () => {
    const camera = new PerspectiveCamera();
    const photo = new PhotoCamera(body);
    photo.start(camera, pose);
    photo.apply(camera, pose);
    const distance = camera.position.distanceTo(middle);
    const height = camera.position.y;

    photo.orbit(400, 0);
    photo.apply(camera, pose);
    expect(camera.position.distanceTo(middle)).toBeCloseTo(distance, 6);
    expect(camera.position.y).toBeCloseTo(height, 6);

    photo.orbit(0, 150);
    photo.apply(camera, pose);
    expect(camera.position.y).toBeGreaterThan(height + 3);
    expect(lookingAtMiddle(camera)).toBeCloseTo(1, 6);
  });

  it('comes nearer and goes farther within limits, and never under the ground', () => {
    const camera = new PerspectiveCamera();
    const photo = new PhotoCamera(body);
    photo.start(camera, pose);

    photo.zoom(0.01);
    expect(photo.distanceMeters).toBeCloseTo(body.lengthMeters / 2 + 1.5, 6);
    photo.zoom(1000);
    expect(photo.distanceMeters).toBe(45);
    photo.zoom(Number.NaN);
    photo.zoom(-2);
    expect(photo.distanceMeters).toBe(45);

    for (const distance of [0.01, 1, 1000]) {
      photo.zoom(distance);
      photo.orbit(0, -10_000);
      photo.apply(camera, pose);
      expect(camera.position.y).toBeGreaterThanOrEqual(0.35 - 1e-9);
      expect(photo.heightMeters).toBeCloseTo(camera.position.y, 6);
    }
    // Straight down at most: never over the top and upside down.
    photo.orbit(0, 10_000);
    photo.apply(camera, pose);
    expect(lookingAtMiddle(camera)).toBeCloseTo(1, 6);
    expect(camera.up.y).toBe(1);
  });

  it('keeps a bigger truck out of the lens when one is bought', () => {
    const biggest = VEHICLES.reduce((most, vehicle) => (vehicle.body.lengthMeters > most.body.lengthMeters ? vehicle : most));
    const photo = new PhotoCamera(body);
    photo.zoom(0.01);
    photo.setBody(biggest.body);
    expect(photo.distanceMeters).toBeCloseTo(biggest.body.lengthMeters / 2 + 1.5, 6);
  });
});
