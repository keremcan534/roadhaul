import {
  Box3,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  PerspectiveCamera,
  Points,
  Quaternion,
  Scene,
  Vector3,
  type BufferAttribute,
} from 'three';
import { describe, expect, it } from 'vitest';
import { VEHICLES } from '../../../../src/data/content/vehicles';
import { VehicleDynamics } from '../../../../src/domain/vehicles/VehicleDynamics';
import { CameraRig } from '../../../../src/presentation/cameras/CameraRig';
import { TruckView } from '../../../../src/presentation/vehicles/TruckView';
import { gpuResources, watchDisposal } from '../../../support/threeResources';

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

function glowsOf(scene: Scene): Points {
  let glows: Points | undefined;
  scene.traverse((object) => {
    if (object instanceof Points) {
      glows = object;
    }
  });
  if (glows === undefined) {
    throw new Error('No lamp glows found.');
  }
  return glows;
}

/** The self-lit lamps' material: the one unlit, opaque material painted per vertex outside the cab. */
function lampMaterialOf(scene: Scene): MeshBasicMaterial {
  const materials = new Set<MeshBasicMaterial>();
  const insideTheCab = new Set(['cab-interior', 'steering-wheel']);
  scene.traverse((object) => {
    if (
      object instanceof Mesh &&
      object.material instanceof MeshBasicMaterial &&
      !object.material.transparent &&
      !insideTheCab.has(object.name)
    ) {
      materials.add(object.material);
    }
  });
  expect(materials.size).toBe(1);
  return [...materials][0]!;
}

describe.each(VEHICLES)('TruckView of $id', (truck) => {
  it('stands the truck at the pose it is given', () => {
    const scene = new Scene();
    const view = new TruckView(scene, truck);
    const state = new VehicleDynamics(truck).createState(0, 0, 0);

    view.update({ x: 12, z: -7, heading: 1.2 }, state, 1 / 60);

    const root = scene.children[0]!;
    expect(root.position.toArray()).toEqual([12, 0, -7]);
    expect(root.rotation.y).toBeCloseTo(1.2, 12);
  });

  it('keeps the wheels on the ground, the front pair on the front axle and the rest around the rear axle', () => {
    const scene = new Scene();
    new TruckView(scene, truck);
    const wheels = wheelsOf(scene);
    const matrix = new Matrix4();
    const position = new Vector3();

    // A heavy truck stands on two rear axles either side of the one the physics uses.
    expect(wheels.count).toBe(truck.vehicleClass === 'heavy' ? 6 : 4);
    // Instance matrices are float32: compare with float32 precision.
    for (let i = 0; i < wheels.count; i++) {
      wheels.getMatrixAt(i, matrix);
      position.setFromMatrixPosition(matrix);
      expect(position.y).toBeCloseTo(truck.body.wheelRadiusMeters, 5);
      if (i < 2) {
        expect(position.z, `front wheel ${i}`).toBeCloseTo(truck.body.wheelbaseMeters, 5);
      } else {
        expect(Math.abs(position.z), `rear wheel ${i}`).toBeLessThan(0.8);
      }
    }
  });

  it('keeps the whole truck within its body dimensions', () => {
    const scene = new Scene();
    const view = new TruckView(scene, truck);
    view.setLoaded(true);
    view.update({ x: 0, z: 0, heading: 0 }, new VehicleDynamics(truck).createState(0, 0, 0), 0);
    scene.updateMatrixWorld(true);
    const bounds = new Box3();
    scene.traverseVisible((object) => {
      if (object instanceof Mesh && !(object.material instanceof MeshBasicMaterial && object.material.transparent)) {
        bounds.expandByObject(object);
      }
    });
    const { lengthMeters, widthMeters, heightMeters, wheelbaseMeters } = truck.body;

    // Mirrors reach a little past the sides, the bumper a hand's width past the nose, the rear lamps a few cm.
    expect(bounds.max.x).toBeLessThanOrEqual(widthMeters / 2 + 0.45);
    expect(bounds.max.y).toBeLessThanOrEqual(heightMeters + 1e-6);
    expect(bounds.min.y).toBeGreaterThanOrEqual(-1e-6);
    expect(bounds.max.z).toBeLessThanOrEqual(wheelbaseMeters / 2 + lengthMeters / 2 + 0.15);
    expect(bounds.min.z).toBeGreaterThanOrEqual(wheelbaseMeters / 2 - lengthMeters / 2 - 0.1);
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
    const directions = Array.from({ length: wheels.count }, (_, i) => {
      wheels.getMatrixAt(i, matrix);
      matrix.decompose(new Vector3(), rotation, new Vector3());
      return forward.set(0, 0, 1).applyQuaternion(rotation).x;
    });
    // Right of +Z is −X: steered front wheels point there, rear wheels straight ahead.
    expect(directions[0]).toBeLessThan(-0.3);
    expect(directions[1]).toBeLessThan(-0.3);
    for (const rear of directions.slice(2)) {
      expect(rear).toBeCloseTo(0, 9);
    }
  });

  it('paints the cab in the colour given, or else in its model\'s factory colour', () => {
    const phongColours = (scene: Scene): Set<number> => {
      const colours = new Set<number>();
      scene.traverse((object) => {
        if (object instanceof Mesh && object.material instanceof MeshPhongMaterial && object.material.map === null) {
          colours.add(object.material.color.getHex());
        }
      });
      return colours;
    };
    const factoryScene = new Scene();
    expect(new TruckView(factoryScene, truck).paint).toBe(truck.factoryColor);
    expect(phongColours(factoryScene).has(truck.factoryColor)).toBe(true);

    const paintedScene = new Scene();
    const painted = new TruckView(paintedScene, truck, { paint: 0x6b3fa0 });
    expect(painted.paint).toBe(0x6b3fa0);
    expect(phongColours(paintedScene).has(0x6b3fa0)).toBe(true);
    expect(phongColours(paintedScene).has(truck.factoryColor)).toBe(false);
  });

  it("swaps the windshield for the cab's inside in cabin view", () => {
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
    // Out: the windshield. In: the dashboard, gauges and pillars, and the steering wheel on its column.
    expect([...outside].filter((object) => !inside.has(object))).toHaveLength(1);
    const added = [...inside].filter((object) => !outside.has(object));
    expect(added.filter((object) => object instanceof Mesh).map((mesh) => (mesh as Mesh).name).sort()).toEqual([
      'cab-interior',
      'steering-wheel',
    ]);

    view.setCabinView(false);
    expect(visible()).toEqual(outside);
  });

  /** The cabin camera of a rig at the driver's seat, and the truck at rest there. */
  function driverSeat(scene: Scene): { camera: PerspectiveCamera; look: () => void } {
    const camera = new PerspectiveCamera(72, 2, 0.1, 500);
    const rig = new CameraRig(camera, truck.body);
    rig.currentMode = 'cabin';
    const atRest = { speed: 0, steerAngle: 0, longitudinalAcceleration: 0, lateralAcceleration: 0 };
    return {
      camera,
      look: () => {
        // The head does not sway here: only the truck's body moves.
        rig.update({ x: 0, z: 0, heading: 0 }, atRest, 1 / 60);
        scene.updateMatrixWorld(true);
        camera.updateMatrixWorld(true);
      },
    };
  }

  it('keeps the cabin dashboard steady in front of the driver while the body leans', () => {
    const scene = new Scene();
    const view = new TruckView(scene, truck);
    view.setCabinView(true);
    const dashboard = scene.getObjectByName('cab-interior') as Mesh;
    const { camera, look } = driverSeat(scene);
    const pose = { x: 0, z: 0, heading: 0 };
    const state = new VehicleDynamics(truck).createState(0, 0, 0);
    /** Screen height (-1 bottom … 1 top) of a point at the front of the cab's inside, as the driver sees it. */
    const dashboardTop = (): number => {
      look();
      const geometry = dashboard.geometry;
      geometry.computeBoundingBox();
      const edge = new Vector3(0, geometry.boundingBox!.max.y - 0.2, geometry.boundingBox!.max.z);
      return dashboard.localToWorld(edge).project(camera).y;
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

  it('turns the steering wheel in sight of the driver: clockwise, as the driver sees it, for a right turn', () => {
    const scene = new Scene();
    const view = new TruckView(scene, truck);
    view.setCabinView(true);
    const wheel = scene.getObjectByName('steering-wheel') as Mesh;
    const { camera, look } = driverSeat(scene);
    const state = new VehicleDynamics(truck).createState(0, 0, 0);
    /** Where the mark at the top of the rim is on the driver's screen (-1 … 1 each way). */
    const mark = (steerAngle: number): Vector3 => {
      state.steerAngle = steerAngle;
      view.update({ x: 0, z: 0, heading: 0 }, state, 1 / 60);
      look();
      return wheel.localToWorld(new Vector3(0, 0.2, 0)).project(camera);
    };

    const ahead = mark(0);
    expect(Math.abs(ahead.x)).toBeLessThan(1);
    expect(ahead.y).toBeGreaterThan(-1); // On screen, at the bottom.
    expect(ahead.y).toBeLessThan(-0.3);
    expect(mark(0.1).x).toBeGreaterThan(ahead.x + 0.05);
    expect(mark(-0.1).x).toBeLessThan(ahead.x - 0.05);
  });

  it('shows a flatbed\'s load only while it is loaded, and never a closed body\'s', () => {
    const scene = new Scene();
    const view = new TruckView(scene, truck);
    const visibleMeshes = (): number => {
      let count = 0;
      scene.traverseVisible((object) => {
        count += object instanceof Mesh ? 1 : 0;
      });
      return count;
    };
    const empty = visibleMeshes();

    view.setLoaded(true);
    expect(visibleMeshes()).toBe(truck.bodyType === 'flatbed' ? empty + 1 : empty);
    view.setLoaded(false);
    expect(visibleMeshes()).toBe(empty);
  });

  it('lights the road ahead and makes its lamps glow at night, and does neither by day', () => {
    const scene = new Scene();
    const view = new TruckView(scene, truck);
    const pool = scene.getObjectByName('headlight-pool') as Mesh;
    const glows = glowsOf(scene);
    const lamps = lampMaterialOf(scene);
    const dayBrightness = lamps.color.r;
    expect(pool.visible).toBe(false);
    expect(glows.visible).toBe(false);

    view.setLamps(1);

    expect(pool.visible).toBe(true);
    expect(glows.visible).toBe(true);
    expect(lamps.color.r).toBeGreaterThan(dayBrightness * 2);
    // The light lies flat on the road, from the front bumper on.
    const front = truck.body.wheelbaseMeters / 2 + truck.body.lengthMeters / 2;
    const bounds = new Box3().setFromBufferAttribute(pool.geometry.getAttribute('position') as BufferAttribute);
    expect(bounds.min.z).toBeCloseTo(front, 5);
    expect(bounds.max.z).toBeGreaterThan(front + 25);
    expect(bounds.max.y - bounds.min.y).toBeLessThan(1e-6);
    expect(bounds.max.y).toBeLessThan(0.2);
    // A glow on each headlight, ahead of the nose, and on each tail light, behind the back.
    expect(glows.geometry.drawRange.count).toBe(4);
    const positions = glows.geometry.getAttribute('position');
    const colors = glows.geometry.getAttribute('color');
    for (let i = 0; i < 4; i++) {
      if (i < 2) {
        expect(positions.getZ(i)).toBeGreaterThan(front);
        expect(colors.getX(i) - colors.getZ(i)).toBeLessThan(0.5); // White, a little warm.
      } else {
        expect(positions.getZ(i)).toBeLessThan(front - truck.body.lengthMeters);
        expect(colors.getX(i) - colors.getZ(i)).toBeGreaterThan(0.8); // Red.
      }
    }

    view.setLamps(0);

    expect(pool.visible).toBe(false);
    expect(glows.visible).toBe(false);
    expect(lamps.color.r).toBe(dayBrightness);
  });

  it('keeps the headlights on the road but leaves out the glows on weaker devices', () => {
    const scene = new Scene();
    const view = new TruckView(scene, truck, { lampGlows: false });

    view.setLamps(1);

    expect((scene.getObjectByName('headlight-pool') as Mesh).visible).toBe(true);
    expect(glowsOf(scene).visible).toBe(false);
  });

  it('releases every GPU resource on dispose', () => {
    const scene = new Scene();
    const view = new TruckView(scene, truck);
    view.setLoaded(true);
    view.setLamps(1);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    view.dispose();

    expect([...resources].filter((resource) => !disposed.has(resource))).toEqual([]);
    expect(scene.children).toEqual([]);
  });
});

describe('TruckView bodies', () => {
  it('builds a different body for each body type', () => {
    const shapes = VEHICLES.map((truck) => {
      const scene = new Scene();
      new TruckView(scene, truck);
      let vertices = 0;
      scene.traverse((object) => {
        if (object instanceof Mesh) {
          vertices += object.geometry.getAttribute('position').count;
        }
      });
      return `${truck.bodyType}:${vertices}`;
    });

    expect(new Set(shapes).size).toBe(VEHICLES.length);
  });
});
