import { InstancedMesh, Matrix4, Quaternion, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { VEHICLES } from '../../../../src/data/content/vehicles';
import { VehicleDynamics } from '../../../../src/domain/vehicles/VehicleDynamics';
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
