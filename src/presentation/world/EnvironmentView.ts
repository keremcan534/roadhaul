import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SeededRandom } from '../../core/random/SeededRandom';
import {
  GROUND_LIGHT_COLOR,
  SKY_LIGHT_COLOR,
  SKY_LIGHT_INTENSITY,
  SUN_COLOR,
  SUN_DIRECTION,
  SUN_INTENSITY,
} from './lighting';

const ZENITH = 0x3f7fc7;
const HORIZON = 0xc4dcef;
const GROUND_HAZE = 0xa9bfcf;
/** Exponential fog: about 60% at 400 m, fully hazy by 700 m. */
const FOG_DENSITY = 0.0023;
const DOME_RADIUS = 800;
const HILL_RADIUS = 640;
const CLOUD_COUNT = 26;

/**
 * Sky, horizon and light: a gradient dome with a sun glow, low-poly clouds,
 * a ring of hazy hills, fog, and the sun and sky lights. The dome, clouds
 * and hills follow the camera (call update() every frame), so they always
 * sit at the horizon. About three draw calls.
 */
export class EnvironmentView {
  private readonly backdrop = new Group();
  private readonly lights: readonly (HemisphereLight | DirectionalLight)[];
  private readonly resources: { dispose(): void }[] = [];

  constructor(private readonly scene: Scene) {
    scene.background = new Color(HORIZON);
    scene.fog = new FogExp2(HORIZON, FOG_DENSITY);

    const sun = new DirectionalLight(SUN_COLOR, SUN_INTENSITY);
    sun.position.set(SUN_DIRECTION.x * 300, SUN_DIRECTION.y * 300, SUN_DIRECTION.z * 300);
    this.lights = [new HemisphereLight(SKY_LIGHT_COLOR, GROUND_LIGHT_COLOR, SKY_LIGHT_INTENSITY), sun];
    scene.add(...this.lights);

    this.backdrop.add(this.createDome(), this.createHills(), this.createClouds());
    scene.add(this.backdrop);
  }

  /** Keeps the backdrop centred on the camera. Allocation-free. */
  update(cameraPosition: Readonly<{ x: number; z: number }>): void {
    this.backdrop.position.set(cameraPosition.x, 0, cameraPosition.z);
  }

  dispose(): void {
    this.scene.remove(this.backdrop, ...this.lights);
    this.scene.background = null;
    this.scene.fog = null;
    for (const resource of this.resources) {
      resource.dispose();
    }
  }

  private createDome(): Mesh {
    const material = this.track(
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          zenith: { value: new Color(ZENITH) },
          horizon: { value: new Color(HORIZON) },
          groundHaze: { value: new Color(GROUND_HAZE) },
          sunColor: { value: new Color(SUN_COLOR) },
          sunDirection: { value: new Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDirection;
          void main() {
            vDirection = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 zenith;
          uniform vec3 horizon;
          uniform vec3 groundHaze;
          uniform vec3 sunColor;
          uniform vec3 sunDirection;
          varying vec3 vDirection;
          void main() {
            vec3 direction = normalize(vDirection);
            float up = direction.y;
            vec3 sky = mix(horizon, zenith, pow(max(up, 0.0), 0.5));
            sky = mix(sky, groundHaze, clamp(-up * 6.0, 0.0, 1.0));
            float toSun = max(dot(direction, sunDirection), 0.0);
            sky += sunColor * (pow(toSun, 900.0) * 3.0 + pow(toSun, 24.0) * 0.18);
            gl_FragColor = vec4(sky, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
    );
    const dome = new Mesh(this.track(new SphereGeometry(DOME_RADIUS, 32, 16)), material);
    // Drawn after everything opaque and depth-tested, so it only shades the sky that is still showing.
    dome.renderOrder = 1;
    dome.frustumCulled = false;
    return dome;
  }

  /** A ring of low-poly hills, coloured toward the haze with height so they read as far away. */
  private createHills(): Mesh {
    const random = new SeededRandom(7);
    const segments = 120;
    const rows = 3;
    const heights: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      heights.push(40 + 34 * Math.sin(a * 3 + 1.3) + 22 * Math.sin(a * 7 + 0.4) + random.range(0, 26));
    }
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const near = new Color(0x5e7d57);
    const far = new Color(HORIZON);
    const scratch = new Color();
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const peak = heights[i % segments]!;
      for (let row = 0; row <= rows; row++) {
        const t = row / rows; // 0 = foot, 1 = ridge.
        const radius = HILL_RADIUS + 60 * t;
        const height = t === 0 ? -8 : peak * Math.sin((t * Math.PI) / 2) * (row === rows ? 0.92 : 1);
        positions.push(Math.cos(a) * radius, height, Math.sin(a) * radius);
        scratch.copy(near).lerp(far, 0.35 + 0.3 * t);
        colors.push(scratch.r, scratch.g, scratch.b);
      }
    }
    for (let i = 0; i < segments; i++) {
      for (let row = 0; row < rows; row++) {
        const a = i * (rows + 1) + row;
        const b = (i + 1) * (rows + 1) + row;
        // Wound so the faces point inward, toward the camera at the centre.
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const hills = new Mesh(
      this.track(geometry),
      this.track(new MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false })),
    );
    hills.frustumCulled = false;
    return hills;
  }

  /** Flat-bottomed clusters of puffs, scattered around the sky. */
  private createClouds(): InstancedMesh {
    const random = new SeededRandom(19);
    const puffs = [
      [0, 0, 0, 1],
      [1.3, -0.2, 0.3, 0.8],
      [-1.2, -0.25, -0.2, 0.75],
      [0.5, 0.35, -0.6, 0.7],
      [-0.4, 0.2, 0.7, 0.65],
    ].map(([x, y, z, r]) => new IcosahedronGeometry(r!, 1).translate(x!, y!, z!));
    const cloud = mergeGeometries(puffs);
    for (const puff of puffs) {
      puff.dispose();
    }
    // Squash the underside flat, like cumulus.
    const position = cloud.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      position.setY(i, Math.max(position.getY(i), -0.35));
    }
    cloud.computeVertexNormals();
    const clouds = this.track(
      new InstancedMesh(
        this.track(cloud),
        this.track(new MeshLambertMaterial({ color: 0xf6f8fb, emissive: 0x6d7a88, flatShading: true, fog: false })),
        CLOUD_COUNT,
      ),
    );
    const matrix = new Matrix4();
    const where = new Vector3();
    const rotation = new Quaternion();
    const size = new Vector3();
    const up = new Vector3(0, 1, 0);
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const angle = random.range(0, Math.PI * 2);
      const distance = random.range(380, 700);
      where.set(Math.cos(angle) * distance, random.range(150, 260), Math.sin(angle) * distance);
      rotation.setFromAxisAngle(up, random.range(0, Math.PI * 2));
      const scale = random.range(18, 38);
      size.set(scale * random.range(1.1, 1.8), scale * random.range(0.55, 0.8), scale);
      clouds.setMatrixAt(i, matrix.compose(where, rotation, size));
    }
    clouds.instanceMatrix.needsUpdate = true;
    clouds.frustumCulled = false;
    return clouds;
  }

  private track<T extends { dispose(): void }>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }
}
