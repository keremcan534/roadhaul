import { Box3, Mesh, MeshBasicMaterial, Scene, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../../src/data/content/maps';
import { rectangleContains } from '../../../../src/data/definitions/MapDefinition';
import { BEACON_COLORS, DepotView } from '../../../../src/presentation/world/DepotView';
import { mapFixture } from '../../../support/contentFixtures';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

const depots = mapFixture().depots;

/** Meshes that would be drawn: visible themselves and all their ancestors. */
function visibleMeshes(root: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverseVisible((object) => {
    if (object instanceof Mesh) {
      meshes.push(object);
    }
  });
  return meshes;
}

describe('DepotView', () => {
  it('draws every yard and bay of the map in two draw calls while no beacon is lit', () => {
    const scene = new Scene();
    new DepotView(scene, MAPS[0]!.depots);

    expect(visibleMeshes(scene)).toHaveLength(2);
  });

  it('paves exactly the yard rectangles, flat on the ground and facing up', () => {
    const scene = new Scene();
    new DepotView(scene, depots);
    const [yards] = visibleMeshes(scene);
    const positions = yards!.geometry.getAttribute('position');
    const normals = yards!.geometry.getAttribute('normal');

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      expect(depots.some((depot) => rectangleContains(depot.yard, x, z, 1e-6))).toBe(true);
      expect(positions.getY(i)).toBeCloseTo(0.02, 9);
      expect(normals.getY(i)).toBeCloseTo(1, 9);
    }
    // The fixture yards run along X (heading 90°): 44 m along X, 26 m along Z.
    const bounds = new Box3().setFromBufferAttribute(positions as never);
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(244, 6); // From x = -122 to x = 122.
    expect(bounds.max.z - bounds.min.z).toBeCloseTo(26, 6);
  });

  it('lights one beacon at a time, in the colour of the task', () => {
    const scene = new Scene();
    const view = new DepotView(scene, depots);

    view.setTarget('test_origin_depot', 'pickup');
    expect(view.targetDepotId).toBe('test_origin_depot');
    expect(visibleMeshes(scene)).toHaveLength(4);
    const beacon = visibleMeshes(scene).slice(2);
    for (const mesh of beacon) {
      expect((mesh.material as MeshBasicMaterial).color.getHex()).toBe(BEACON_COLORS.pickup);
    }
    // See-through from both sides, in one draw call each: not back, then front, with the shader set up for each.
    expect(beacon.map((mesh) => drawCallCount(mesh))).toEqual([1, 1]);
    // The beacon stands over the origin bay.
    const walls = new Box3().setFromObject(beacon[0]!);
    expect((walls.min.x + walls.max.x) / 2).toBeCloseTo(-100, 6);
    expect((walls.min.z + walls.max.z) / 2).toBeCloseTo(-17, 6);

    view.setTarget('test_destination_depot', 'delivery');
    expect(view.targetDepotId).toBe('test_destination_depot');
    expect(visibleMeshes(scene)).toHaveLength(4);
    expect((visibleMeshes(scene)[2]!.material as MeshBasicMaterial).color.getHex()).toBe(BEACON_COLORS.delivery);

    view.setTarget(null);
    expect(view.targetDepotId).toBeNull();
    expect(visibleMeshes(scene)).toHaveLength(2);
    expect(() => view.setTarget('atlantis_depot')).toThrow('Unknown depot "atlantis_depot".');
  });

  it('pulses the lit beacon', () => {
    const scene = new Scene();
    const view = new DepotView(scene, depots);
    view.setTarget('test_origin_depot', 'pickup');
    const material = visibleMeshes(scene)[2]!.material as MeshBasicMaterial;

    const seen = new Set<number>();
    for (let i = 0; i < 10; i++) {
      view.update(0.1, 0, 0);
      seen.add(Math.round(material.opacity * 100));
    }

    expect(seen.size).toBeGreaterThan(3);
    for (const opacity of seen) {
      expect(opacity).toBeGreaterThan(0);
      expect(opacity).toBeLessThanOrEqual(100);
    }
  });

  it('fades the light pillar out as the camera comes close, leaving the walls', () => {
    const scene = new Scene();
    const view = new DepotView(scene, depots);
    view.setTarget('test_origin_depot', 'pickup');
    const [walls, pillar] = visibleMeshes(scene).slice(2).map((mesh) => mesh.material as MeshBasicMaterial);

    view.update(0.1, 100, 0); // 200 m away.
    const farOpacity = pillar!.opacity;
    view.update(0.1, -100, -57); // 40 m away.
    const nearerOpacity = pillar!.opacity;
    view.update(0.1, -100, -27); // 10 m away.

    expect(farOpacity).toBeGreaterThan(0.3);
    expect(nearerOpacity).toBeGreaterThan(0);
    expect(nearerOpacity).toBeLessThan(farOpacity);
    expect(pillar!.visible).toBe(false);
    expect(walls!.visible).toBe(true);
    expect(walls!.opacity).toBeGreaterThan(0.5);
  });

  it('draws nothing for a map without depots', () => {
    const scene = new Scene();
    new DepotView(scene, []);

    expect(drawCallCount(scene)).toBe(0);
  });

  it('removes itself and releases every GPU resource on dispose', () => {
    const scene = new Scene();
    const view = new DepotView(scene, depots);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    view.dispose();

    expect(scene.children).toHaveLength(0);
    expect(disposed.size).toBe(resources.size);
  });
});
