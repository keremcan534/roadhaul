import { BatchedMesh, Box3, BufferGeometry, DoubleSide, InstancedMesh, Line, Material, Mesh, Points, Texture, type Object3D } from 'three';

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

/** A tile of a TileBatch (a BatchedMesh): its box in the world, whether it is drawn, and where its vertices lie. */
export interface BatchTile {
  readonly box: Box3;
  readonly visible: boolean;
  readonly vertexStart: number;
  readonly vertexCount: number;
  readonly triangles: number;
}

/** The tiles a TileBatch's mesh holds, an instance each. */
export function batchTiles(mesh: BatchedMesh): BatchTile[] {
  const tiles: BatchTile[] = [];
  for (let instance = 0; instance < mesh.instanceCount; instance++) {
    const geometry = mesh.getGeometryIdAt(instance);
    const range = mesh.getGeometryRangeAt(geometry)!;
    tiles.push({
      box: mesh.getBoundingBoxAt(geometry, new Box3())!,
      visible: mesh.visible && mesh.getVisibleAt(instance),
      vertexStart: range.vertexStart,
      vertexCount: range.vertexCount,
      triangles: (mesh.geometry.index === null ? range.vertexCount : range.indexCount) / 3,
    });
  }
  return tiles;
}

/**
 * The materials under `root` drawn by more than one kind of object (a mesh, an instanced mesh, a batch): three.js
 * keeps one program current per material, and one drawn by two kinds has its program looked up again twice a frame.
 */
export function materialsOfMixedKinds(root: Object3D): string[] {
  const kinds = new Map<Material, Map<string, string>>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }
    const kind = object instanceof BatchedMesh ? 'batch' : object instanceof InstancedMesh ? 'instanced' : 'mesh';
    for (const material of [object.material].flat() as Material[]) {
      const users = kinds.get(material) ?? new Map<string, string>();
      users.set(kind, object.name);
      kinds.set(material, users);
    }
  });
  return [...kinds.values()].filter((users) => users.size > 1).map((users) => [...users].map(([kind, name]) => `${kind} ${name}`).join(' + '));
}
