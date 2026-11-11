import {
  BoxGeometry,
  BufferAttribute,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AMBER_LIGHT, GREEN_LIGHT, RED_LIGHT, signalLight, type SignalHead, type SignalLight } from '../../domain/traffic/trafficSignals';
import { NearInstances } from '../world/NearInstances';

/** The pole's height, and the head on it: its size and its three lenses (red on top), meters. */
const POLE_METERS = 4;
const HEAD_WIDTH = 0.46;
const HEAD_HEIGHT = 1.26;
const HEAD_DEPTH = 0.32;
const LENS_SIZE = 0.3;
const LENS_YS = [POLE_METERS + 1.02, POLE_METERS + 0.63, POLE_METERS + 0.24] as const;
const POLE_COLOR = 0x3c4248;
const HEAD_COLOR = 0x23272b;
/** Each lens's colour lit, and dark. */
const LIT = [0xff3a2a, 0xffb21e, 0x3cf07a] as const;
const DARK = [0x4a1a16, 0x4a3a14, 0x173a22] as const;
/** The lights are drawn this far from the camera, meters (as the street lamps). */
const SIGNAL_REACH_METERS = 700;
/** Which lens (0 red, 1 amber, 2 green) a light lights. */
const LENS_OF: Readonly<Record<SignalLight, number>> = { [GREEN_LIGHT]: 2, [AMBER_LIGHT]: 1, [RED_LIGHT]: 0 };

/**
 * The traffic lights (domain/traffic/trafficSignals.ts): a pole with a head
 * of three lenses beside each approach's stop line, the lit lens following
 * the traffic's time (update). Two draw calls for all of them: the poles and
 * heads, and the lenses (flat, unlit, so they shine at night too),
 * recoloured only when the lights change; only those within
 * SIGNAL_REACH_METERS of the camera are drawn (showAround).
 */
export class TrafficSignalView {
  private readonly root = new Group();
  private readonly poles: InstancedMesh;
  private readonly lenses: InstancedMesh;
  /** The poles and lenses near the camera, drawn in place of all of them. */
  private readonly near: readonly NearInstances[];
  private readonly groups: Uint8Array;
  private readonly shown = [-1, -1];
  private readonly color = new Color();

  constructor(
    private readonly scene: Scene,
    heads: readonly SignalHead[],
  ) {
    this.root.name = 'traffic-signals';
    this.groups = Uint8Array.from(heads, (head) => head.group);
    this.poles = new InstancedMesh(poleGeometry(), new MeshLambertMaterial({ vertexColors: true }), Math.max(1, heads.length));
    this.poles.name = 'traffic-signals:poles';
    const lens = new PlaneGeometry(LENS_SIZE, LENS_SIZE);
    lens.deleteAttribute('uv');
    this.lenses = new InstancedMesh(lens, new MeshBasicMaterial({ color: 0xffffff }), Math.max(1, heads.length * 3));
    this.lenses.name = 'traffic-signals:lenses';
    const matrix = new Matrix4();
    const lensMatrix = new Matrix4();
    heads.forEach((head, index) => {
      matrix.makeRotationY(head.heading).setPosition(head.x, head.y, head.z);
      this.poles.setMatrixAt(index, matrix);
      for (let k = 0; k < 3; k++) {
        lensMatrix.makeTranslation(0, LENS_YS[k]!, HEAD_DEPTH / 2 + 0.01).premultiply(matrix);
        this.lenses.setMatrixAt(index * 3 + k, lensMatrix);
        this.lenses.setColorAt(index * 3 + k, this.color.setHex(DARK[k]!));
      }
    });
    this.poles.count = heads.length;
    this.lenses.count = heads.length * 3;
    this.near = [new NearInstances(this.poles, SIGNAL_REACH_METERS), new NearInstances(this.lenses, SIGNAL_REACH_METERS)];
    for (const near of this.near) {
      near.mesh.matrixAutoUpdate = false;
      this.root.add(near.mesh);
    }
    if (heads.length > 0) {
      scene.add(this.root);
    }
  }

  /** Lights each head's lens for the traffic's time, `seconds`. Cheap unless the lights change; allocation-free. */
  update(seconds: number): void {
    let changed = false;
    for (let group = 0; group < 2; group++) {
      const light = signalLight(seconds, group);
      if (this.shown[group] !== light) {
        this.shown[group] = light;
        changed = true;
      }
    }
    if (!changed) {
      return;
    }
    for (let index = 0; index < this.groups.length; index++) {
      const lit = LENS_OF[this.shown[this.groups[index]!]! as SignalLight];
      for (let k = 0; k < 3; k++) {
        this.lenses.setColorAt(index * 3 + k, this.color.setHex(k === lit ? LIT[k]! : DARK[k]!));
      }
    }
    this.near[1]!.refresh();
  }

  /** Draws the lights near (x, z), the camera, only. Allocation-free: call it every frame. */
  showAround(x: number, z: number): void {
    this.near[0]!.showAround(x, z);
    this.near[1]!.showAround(x, z);
  }

  /** The lenses' colours as shown, 0xRRGGBB per lens (for tests). */
  lensColor(index: number): number {
    this.lenses.getColorAt(index, this.color);
    return this.color.getHex();
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const near of this.near) {
      near.dispose();
    }
    for (const mesh of [this.poles, this.lenses]) {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
      mesh.dispose();
    }
  }
}

/** A pole with its head on top, facing +Z, coloured per vertex. */
function poleGeometry(): BufferGeometry {
  const parts: [BufferGeometry, number][] = [
    [new BoxGeometry(0.16, POLE_METERS, 0.16).translate(0, POLE_METERS / 2, 0), POLE_COLOR],
    [new BoxGeometry(HEAD_WIDTH, HEAD_HEIGHT, HEAD_DEPTH).translate(0, POLE_METERS + HEAD_HEIGHT / 2, 0), HEAD_COLOR],
  ];
  const color = new Color();
  for (const [part, hex] of parts) {
    part.deleteAttribute('uv');
    color.setHex(hex);
    const count = part.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    part.setAttribute('color', new BufferAttribute(colors, 3));
  }
  const merged = mergeGeometries(parts.map(([part]) => part));
  for (const [part] of parts) {
    part.dispose();
  }
  return merged;
}
