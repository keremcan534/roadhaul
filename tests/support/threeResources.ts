import { BufferGeometry, DoubleSide, InstancedMesh, Line, Material, Mesh, Points, Texture, type Object3D } from 'three';

type GpuResource = BufferGeometry | Material | InstancedMesh | Texture;

/** Objects that draw: meshes (instanced or not), points and lines. */
function isDrawn(object: Object3D): object is Mesh | Points | Line {
  return object instanceof Mesh || object instanceof Points || object instanceof Line;
}

/** Every GPU-backed resource in a subtree: geometries, materials, their textures and instanced meshes. */
export function gpuResources(root: Object3D): Set<GpuResource> {
  const resources = new Set<GpuResource>();
  root.traverse((object) => {
    if (isDrawn(object)) {
      resources.add(object.geometry as BufferGeometry);
      for (const material of [object.material].flat() as Material[]) {
        resources.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof Texture) {
            resources.add(value);
          }
        }
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

/**
 * Number of draw calls a subtree costs with everything shown: one per mesh
 * (instanced or not), points or lines; two for a translucent two-sided
 * material, which three.js draws back side first, then front side, unless
 * it is forced into a single pass.
 */
export function drawCallCount(root: Object3D): number {
  let count = 0;
  root.traverse((object) => {
    if (isDrawn(object)) {
      const material = object.material as Material;
      count += material.transparent && material.side === DoubleSide && !material.forceSinglePass ? 2 : 1;
    }
  });
  return count;
}
