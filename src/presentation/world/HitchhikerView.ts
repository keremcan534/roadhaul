import { BoxGeometry, Mesh, MeshLambertMaterial, type BufferGeometry, type Scene } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';
import { colored } from './lotParts';

/** What the view reads (HitchhikerService): whether someone waits, and where. */
export interface HitchhikerSource {
  readonly stage: 'none' | 'waiting' | 'riding';
  readonly spot: { readonly x: number; readonly z: number; readonly heading: number };
}

const JACKET = 0xff7a1a;
const JEANS = 0x2b3a55;
const SKIN = 0xe0b48c;
const CAP = 0x2f6dff;
const PACK = 0x3e7d3a;
const ROLL = 0x8a6a3e;

/**
 * A hitchhiker waiting by the road (HitchhikerService): a walker in a bright
 * jacket with a backpack and a bedroll, facing the road, the arm toward the
 * traffic coming held out, thumb up. One mesh of a few dozen triangles,
 * drawn only while someone waits.
 */
export class HitchhikerView {
  private readonly geometry: BufferGeometry;
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly mesh: Mesh;
  private world: DrivingWorld | null = null;

  constructor(private readonly scene: Scene) {
    this.geometry = hitchhikerGeometry();
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.name = 'hitchhiker';
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }

  setWorld(world: DrivingWorld): void {
    this.world = world;
  }

  /** Per frame: shown where someone waits. Allocation-free. */
  update(source: HitchhikerSource): void {
    const waiting = source.stage === 'waiting';
    this.mesh.visible = waiting;
    if (!waiting) {
      return;
    }
    const { x, z, heading } = source.spot;
    this.mesh.position.set(x, this.world?.terrain.heightAt(x, z) ?? 0, z);
    this.mesh.rotation.y = heading;
    this.mesh.updateMatrix();
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** The walker, standing on y = 0, facing +z, the thumb arm out along +x. Exported for tests. */
export function hitchhikerGeometry(): BufferGeometry {
  const part = (width: number, height: number, depth: number, x: number, y: number, z: number, color: number, tilt = 0): BufferGeometry =>
    colored(new BoxGeometry(width, height, depth).rotateZ(tilt).translate(x, y, z), color);
  const parts = [
    part(0.16, 0.85, 0.18, -0.1, 0.425, 0, JEANS),
    part(0.16, 0.85, 0.18, 0.1, 0.425, 0, JEANS),
    part(0.46, 0.6, 0.26, 0, 1.15, 0, JACKET),
    part(0.22, 0.24, 0.22, 0, 1.6, 0.01, SKIN),
    part(0.25, 0.08, 0.27, 0, 1.75, 0.03, CAP),
    part(0.36, 0.5, 0.18, 0, 1.15, -0.22, PACK),
    part(0.44, 0.13, 0.14, 0, 1.47, -0.22, ROLL),
    // The other arm hanging, and the thumb arm out toward the traffic, a little raised.
    part(0.12, 0.56, 0.12, -0.3, 1.1, 0, JACKET),
    part(0.52, 0.12, 0.12, 0.46, 1.36, 0.04, JACKET, 0.18),
    part(0.06, 0.14, 0.06, 0.72, 1.5, 0.04, SKIN),
  ];
  const merged = mergeGeometries(parts);
  for (const geometry of parts) {
    geometry.dispose();
  }
  return merged;
}
