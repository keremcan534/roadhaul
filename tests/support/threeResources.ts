import { BufferGeometry, InstancedMesh, Material, Mesh, type Object3D } from 'three';

type GpuResource = BufferGeometry | Material | InstancedMesh;

/** Every GPU-backed resource in a subtree: geometries, materials and instanced meshes. */
export function gpuResources(root: Object3D): Set<GpuResource> {
  const resources = new Set<GpuResource>();
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

/** Records which of `resources` fire their "dispose" event. */
export function watchDisposal(resources: Iterable<GpuResource>): Set<GpuResource> {
  const disposed = new Set<GpuResource>();
  for (const resource of resources) {
    (resource as BufferGeometry).addEventListener('dispose', () => disposed.add(resource));
  }
  return disposed;
}

/** Number of draw calls a subtree costs: one per mesh (instanced or not). */
export function drawCallCount(root: Object3D): number {
  let count = 0;
  root.traverse((object) => {
    if (object instanceof Mesh) {
      count++;
    }
  });
  return count;
}
