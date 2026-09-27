import { BoxGeometry, Group, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DebrisSimulation, type DebrisLaunch } from '../../../../src/domain/crash/DebrisSimulation';
import { DebrisInstances } from '../../../../src/presentation/effects/DebrisInstances';

const SHAPE = { halfX: 0.3, halfY: 1, halfZ: 0.2, massKg: 20, restitution: 0.3, friction: 0.6 };

function launch(overrides: Partial<DebrisLaunch> = {}): DebrisLaunch {
  return { kind: 1, ref: 0, shape: SHAPE, x: 5, y: 1, z: 7, heading: 0, vx: 0, vy: 0, vz: 0, spinX: 0, spinY: 0, spinZ: 0, ...overrides };
}

describe('DebrisInstances', () => {
  it('draws each body added from its foot, between its last two poses, and nothing when none is', () => {
    const parent = new Group();
    const instances = new DebrisInstances(parent, new BoxGeometry(), new MeshBasicMaterial(), 4, SHAPE.halfY, 0.5);
    const debris = new DebrisSimulation(4);
    const slot = debris.launch(launch({ heading: Math.PI / 2, vx: 6 }));
    debris.step(1 / 60);

    instances.begin();
    expect(instances.add(debris, slot, 0.5)).toBe(0);
    instances.end();

    expect(instances.mesh.visible).toBe(true);
    expect(instances.mesh.count).toBe(1);
    const matrix = new Matrix4();
    instances.mesh.getMatrixAt(0, matrix);
    const position = new Vector3();
    const turn = new Quaternion();
    matrix.decompose(position, turn, new Vector3());
    // Halfway through the step; the foot 1 m under the middle and 0.5 m behind it (turned to face +x: toward -x).
    const middleX = (debris.previousX[slot]! + debris.x[slot]!) / 2;
    expect(position.x).toBeCloseTo(middleX - 0.5, 4);
    expect(position.y).toBeCloseTo((debris.previousY[slot]! + debris.y[slot]!) / 2 - 1, 4);
    expect(position.z).toBeCloseTo(7, 4);
    expect(turn.angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2))).toBeLessThan(1e-4);

    instances.begin();
    instances.end();
    expect(instances.mesh.visible).toBe(false);
    expect(instances.mesh.count).toBe(0);
  });

  it('draws no more than it has room for', () => {
    const instances = new DebrisInstances(new Group(), new BoxGeometry(), new MeshBasicMaterial(), 1, 1);
    const debris = new DebrisSimulation(2);
    debris.launch(launch());
    debris.launch(launch({ x: 9 }));
    instances.begin();
    expect(instances.add(debris, 0, 1)).toBe(0);
    expect(instances.add(debris, 1, 1)).toBe(-1);
    instances.end();
    expect(instances.mesh.count).toBe(1);
  });
});
