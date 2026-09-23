import { InstancedMesh, Matrix4, Mesh, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { VEHICLES } from '../../../../src/data/content/vehicles';
import { VehicleDynamics } from '../../../../src/domain/vehicles/VehicleDynamics';
import { CameraRig } from '../../../../src/presentation/cameras/CameraRig';
import { TruckView } from '../../../../src/presentation/vehicles/TruckView';
import { gpuResources, watchDisposal } from '../../../support/threeResources';

const truck = VEHICLES[0]!;

function wheelsOf(scene: Scene): InstancedMesh {
  let wheels: InstancedMesh | undefined;
  scene.traverse((object) => {
    if (object instanceof InstancedMesh) {
      wheels = object;
    }
  });
  if (wheels === undefined) {
    throw new Error('No wheels found.');
  }
  return wheels;
}

describe('TruckView', () => {
  it('stands the truck at the pose it is given', () => {
    const scene = new Scene();
    const view = new TruckView(scene, truck);
    const state = new VehicleDynamics(truck).createState(0, 0, 0);

    view.update({ x: 12, z: -7, heading: 1.2 }, state, 1 / 60);

    const root = scene.children[0]!;
    expect(root.position.toArray()).toEqual([12, 0, -7]);
    expect(root.rotation.y).toBeCloseTo(1.2, 12);
  });

  it('keeps the wheels on the ground and the whole truck within its body length', () => {
    const scene = new Scene();
    new TruckView(scene, truck);
    const wheels = wheelsOf(scene);
    const matrix = new Matrix4();
    const position = new Vector3();

    // Instance matrices are float32: compare with float32 precision.
    for (let i = 0; i < wheels.count; i++) {
      wheels.getMatrixAt(i, matrix);
      position.setFromMatrixPosition(matrix);
      expect(position.y).toBeCloseTo(truck.body.wheelRadiusMeters, 5);
      const onAnAxle = [0, truck.body.wheelbaseMeters].some((axleZ) => Math.abs(position.z - axleZ) < 1e-5);
      expect(onAnAxle, `wheel ${i} at z=${position.z}`).toBe(true);
    }
  });

  it('steers the front wheels only, to the right for a positive steering angle', () => {
    const scene = new Scene();
    const view = new TruckView(scene, truck);
    const state = new VehicleDynamics(truck).createState(0, 0, 0);
    state.steerAngle = 0.4;

    view.update({ x: 0, z: 0, heading: 0 }, state, 1 / 60);

    const wheels = wheelsOf(scene);
    const matrix = new Matrix4();
    const rotation = new Quaternion();
    const forward = new Vector3();
    const directions = [0, 1, 2, 3].map((i) => {
      wheels.getMatrixAt(i, matrix);
      matrix.decompose(new Vector3(), rotation, new Vector3());
      return forward.set(0, 0, 1).applyQuaternion(rotation).x;
    });
    // Right of +Z is −X: steered front wheels point there, rear wheels straight ahead.
    expect(directions[0]).toBeLessThan(-0.3);
    expect(directions[1]).toBeLessThan(-0.3);
    expect(directions[2]).toBeCloseTo(0, 9);
    expect(directions[3]).toBeCloseTo(0, 9);
  });

  it('swaps the windshield for a dashboard in cabin view', () => {
    const scene = new Scene();
    const view = new TruckView(scene, truck);
    const visible = (): Set<unknown> => {
      const objects = new Set<unknown>();
      scene.traverseVisible((object) => objects.add(object));
      return objects;
    };
    const outside = visible();

    view.setCabinView(true);
    const inside = visible();
    expect(inside.size).toBe(outside.size);
    expect([...inside].filter((object) => !outside.has(object))).toHaveLength(1);

    view.setCabinView(false);
    expect(visible()).toEqual(outside);
  });

  it('keeps the cabin dashboard steady in front of the driver while the body leans', () => {
    const scene = new Scene();
    const view = new TruckView(scene, truck);
    const chaseObjects = new Set<unknown>();
    scene.traverseVisible((object) => chaseObjects.add(object));
    view.setCabinView(true);
    let dashboard: Mesh | undefined;
    scene.traverseVisible((object) => {
      if (!chaseObjects.has(object) && object instanceof Mesh) {
        dashboard = object;
      }
    });
    const camera = new PerspectiveCamera(72, 2, 0.1, 500);
    const rig = new CameraRig(camera, truck.body);
    rig.toggleMode();
    const pose = { x: 0, z: 0, heading: 0 };
    const state = new VehicleDynamics(truck).createState(0, 0, 0);
    /** Screen height (-1 bottom … 1 top) of the dashboard's top front edge, as the driver sees it. */
    const dashboardTop = (): number => {
      rig.update(pose, state.speed, 1 / 60);
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      const geometry = dashboard!.geometry;
      geometry.computeBoundingBox();
      const edge = new Vector3(0, geometry.boundingBox!.max.y, geometry.boundingBox!.max.z);
      return dashboard!.localToWorld(edge).project(camera).y;
    };
    view.update(pose, state, 1 / 60);
    const atRest = dashboardTop();

    // Full throttle, then full braking: the body pitches back and forth by several degrees.
    for (const acceleration of [3, -6]) {
      state.longitudinalAcceleration = acceleration;
      for (let frame = 0; frame < 120; frame++) {
        view.update(pose, state, 1 / 60);
      }
      expect(dashboardTop()).toBeCloseTo(atRest, 3);
    }
  });

  it('releases every GPU resource on dispose', () => {
    const scene = new Scene();
    const view = new TruckView(scene, truck);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    view.dispose();

    expect([...resources].filter((resource) => !disposed.has(resource))).toEqual([]);
    expect(scene.children).toEqual([]);
  });
});
