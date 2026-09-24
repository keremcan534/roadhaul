import { InstancedMesh, Matrix4, Points, Quaternion, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { WindTurbine } from '../../../../src/domain/world/DrivingWorld';
import { TURBINE_HUB_HEIGHT, WindTurbineView } from '../../../../src/presentation/world/WindTurbineView';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

const TURBINES: readonly WindTurbine[] = [
  { x: 0, z: 0, radius: 2.4 },
  { x: 200, z: 40, radius: 2.4 },
];

function rotorsOf(scene: Scene): InstancedMesh {
  return scene.getObjectByName('turbine-rotors') as InstancedMesh;
}

function glowsOf(scene: Scene): Points {
  let glows: Points | undefined;
  scene.traverse((object) => {
    if (object instanceof Points) glows = object;
  });
  return glows!;
}

/** The rotation of rotor `index`, as a quaternion. */
function rotorTurn(scene: Scene, index: number): Quaternion {
  const matrix = new Matrix4();
  rotorsOf(scene).getMatrixAt(index, matrix);
  const turn = new Quaternion();
  matrix.decompose(new Vector3(), turn, new Vector3());
  return turn;
}

describe('WindTurbineView', () => {
  it('draws every tower and rotor in two draw calls, and the warning lights in one', () => {
    const scene = new Scene();
    new WindTurbineView(scene, TURBINES);

    expect(drawCallCount(scene)).toBe(3);
    const withoutGlows = new Scene();
    new WindTurbineView(withoutGlows, TURBINES, { lampGlows: false });
    expect(drawCallCount(withoutGlows)).toBe(2);
  });

  it('puts each rotor at the top of its tower', () => {
    const scene = new Scene();
    new WindTurbineView(scene, TURBINES);
    const matrix = new Matrix4();
    const hub = new Vector3();

    TURBINES.forEach((turbine, index) => {
      rotorsOf(scene).getMatrixAt(index, matrix);
      hub.setFromMatrixPosition(matrix);
      expect(hub.y).toBe(TURBINE_HUB_HEIGHT);
      expect(Math.hypot(hub.x - turbine.x, hub.z - turbine.z)).toBeLessThan(6);
    });
  });

  it('turns the rotors as time passes, and holds them still without it', () => {
    const scene = new Scene();
    const view = new WindTurbineView(scene, TURBINES);
    const before = rotorTurn(scene, 0);

    view.update(0);
    expect(rotorTurn(scene, 0).angleTo(before)).toBeLessThan(1e-9);
    view.update(0.5);
    expect(rotorTurn(scene, 0).angleTo(before)).toBeGreaterThan(0.5);
  });

  it('blinks the warning lights at night only', () => {
    const scene = new Scene();
    const view = new WindTurbineView(scene, TURBINES);
    const glows = glowsOf(scene);

    view.update(0.1);
    expect(glows.visible).toBe(false);

    view.setLamps(1);
    const shown: boolean[] = [];
    for (let frame = 0; frame < 60; frame++) {
      view.update(0.05);
      shown.push(glows.visible);
    }
    expect(shown).toContain(true);
    expect(shown).toContain(false);
  });

  it('releases every GPU resource on dispose', () => {
    const scene = new Scene();
    const view = new WindTurbineView(scene, TURBINES);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    view.dispose();

    expect([...resources].filter((resource) => !disposed.has(resource))).toEqual([]);
    expect(scene.children).toEqual([]);
  });
});
