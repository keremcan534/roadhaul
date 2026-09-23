import { BufferGeometry, InstancedMesh, Material, Mesh, PerspectiveCamera, Scene, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { PlaceholderWorldView } from '../../../../src/presentation/world/PlaceholderWorldView';

/** Every GPU-backed resource in the subtree: geometries, materials and instanced meshes. */
function gpuResources(root: Object3D): Set<BufferGeometry | Material | InstancedMesh> {
  const resources = new Set<BufferGeometry | Material | InstancedMesh>();
  root.traverse((object) => {
    if (object instanceof Mesh) {
      resources.add(object.geometry as BufferGeometry);
      for (const material of [object.material].flat() as Material[]) {
        resources.add(material);
      }
    }
    if (object instanceof InstancedMesh) {
      resources.add(object);
    }
  });
  return resources;
}

describe('PlaceholderWorldView', () => {
  it('releases every GPU resource it created on dispose', () => {
    const scene = new Scene();
    const view = new PlaceholderWorldView(scene);
    const resources = gpuResources(scene);
    const disposed = new Set<unknown>();
    for (const resource of resources) {
      (resource as BufferGeometry).addEventListener('dispose', () => disposed.add(resource));
    }

    view.dispose();

    expect(resources.size).toBeGreaterThan(0);
    expect([...resources].filter((resource) => !disposed.has(resource))).toEqual([]);
    expect(scene.children).toEqual([]);
    expect(scene.background).toBeNull();
    expect(scene.fog).toBeNull();
  });

  it('keeps the camera circling the truck at a fixed height', () => {
    const view = new PlaceholderWorldView(new Scene());
    const camera = new PerspectiveCamera();

    view.update(0.5, camera);
    const first = camera.position.clone();
    view.update(0.5, camera);

    expect(camera.position.y).toBe(first.y);
    expect(camera.position.distanceTo(first)).toBeGreaterThan(0);
  });
});
