// The launcher icon's front layer (scripts/androidIcons.mjs): the game's own starter truck (TruckView, rh_h1) at
// dusk, its lamps on and its windscreen mirroring a blue sky with two glare bands. It is the Google Play icon's shot
// (made with the same scene: SHOT below), drawn on a transparent background. The camera stands where the store
// icon's stands; only the frame widens and moves, as a crop of a wider picture would, so that the cab's outline fits
// inside the adaptive icon's safe circle.
//
// The page draws once, ?size pixels square for the layer's 108 units, and leaves on `window.launcherIcon` the
// picture (premultiplied RGBA rows, top first, in base64) and where the store icon's frame lies in it.
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshPhongMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { VEHICLES } from '../../src/data/content/vehicles';
import { VehicleDynamics } from '../../src/domain/vehicles/VehicleDynamics';
import { TruckView } from '../../src/presentation/vehicles/TruckView';
import { cabGeometry } from '../../src/presentation/vehicles/cabGeometry';

/** What the page leaves for androidIcons.mjs. */
export interface LauncherIconPicture {
  /** `size` × `size` premultiplied RGBA pixels, rows top first, in base64. */
  readonly pixels: string;
  readonly size: number;
  /**
   * The store icon's frame in the picture: its middle (x, y) and the layer's half-width, in the store frame's own
   * normalized units (-1..1 across it, y up).
   */
  readonly frame: { readonly x: number; readonly y: number; readonly half: number };
}

declare global {
  interface Window {
    launcherIcon?: LauncherIconPicture;
  }
}

/** The dusk sky's colours (the store scene's `sky=dusk`); androidIcons.mjs paints the same gradient behind. */
const DUSK = {
  top: '#1d2a5c',
  horizon: '#ffb25a',
  key: '#ffe2c0',
  rim: '#ff9a3c',
  hemiSky: '#8fa6d8',
  hemiGround: '#5a4030',
  fog: '#e9a46a',
};

/**
 * The store icon's shot (the store icon scene's query: az=26 dist=5.2 ly=1.8 fov=46 h=0.85 back=1.2 side=-0.1
 * keyI=2.6 rimI=3.4 exposure=1.25 lamps=1 glass streak=1 kx=7 ky=9 kz=16 rx=-10 ry=7 rz=-8 hemi=1.8). The camera
 * looks at a point `back` metres behind the headlamps' midpoint (`side` to the truck's left) at `lookHeight`, from
 * `distance` metres away, `azimuth` degrees round from straight ahead toward the truck's left, the eye `eyeHeight` up.
 */
const SHOT = {
  azimuth: 26,
  distance: 5.2,
  lookHeight: 1.8,
  fov: 46,
  eyeHeight: 0.85,
  back: 1.2,
  side: -0.1,
  exposure: 1.25,
  hemi: 1.8,
  keyIntensity: 2.6,
  key: [7, 9, 16],
  rimIntensity: 3.4,
  rim: [-10, 7, -8],
  fog: 0.012,
  lamps: 1,
  /** The sky the windscreen mirrors instead of the dusk: a blue one, so the glass reads as glass at a thumbnail. */
  glass: { zenith: '#1b2c52', horizon: '#a9cdf0', facing: 0.5 },
  /** How bright the two glare bands across the windscreen are. */
  streak: 1,
} as const;
/** The glass's colour in TruckView, which picks its material out. */
const GLASS_COLOR = 0x22323f;

const query = new URLSearchParams(location.search);
const SIZE = Number(query.get('size') ?? 1296);
/** How far the cab's outline reaches from the layer's middle, of its 108 units: the safe circle's radius is 33. */
const CAB_RADIUS = Number(query.get('cab') ?? 32);

const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = SHOT.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.fog = new FogExp2(new Color(DUSK.fog), SHOT.fog);
scene.add(new HemisphereLight(new Color(DUSK.hemiSky), new Color(DUSK.hemiGround), SHOT.hemi));
const key = new DirectionalLight(new Color(DUSK.key), SHOT.keyIntensity);
key.position.set(...SHOT.key);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -10;
key.shadow.camera.right = 10;
key.shadow.camera.top = 10;
key.shadow.camera.bottom = -10;
key.shadow.camera.near = 1;
key.shadow.camera.far = 60;
key.shadow.camera.updateProjectionMatrix();
key.shadow.bias = -0.0005;
scene.add(key);
const rim = new DirectionalLight(new Color(DUSK.rim), SHOT.rimIntensity);
rim.position.set(...SHOT.rim);
scene.add(rim);

// The truck: the game's model in its factory paint, standing level, lamps on.
const definition = VEHICLES.find((vehicle) => vehicle.id === 'rh_h1');
if (definition === undefined) {
  throw new Error('The starter truck, rh_h1, is not among the vehicles.');
}
const sky = {
  zenith: { value: new Color(DUSK.top) },
  horizon: { value: new Color(DUSK.horizon) },
  sunColor: { value: new Color(DUSK.rim) },
  sunDirection: { value: new Vector3(...SHOT.rim).normalize() },
};
const cab = cabGeometry(definition.body);
const truck = new TruckView(scene, definition, { castShadows: true, sky, lampGlows: true });
truck.update({ x: 0, z: 0, heading: 0 }, new VehicleDynamics(definition).createState(0, 0, 0), 0);
truck.setLamps(SHOT.lamps);
scene.traverse((object) => {
  if (object instanceof Mesh) {
    object.castShadow = true;
  }
});

// The camera, placed round the truck's front as the store icon's is.
const lampLeft = new Vector3();
const lampRight = new Vector3();
const forward = new Vector3();
truck.headlamps(lampLeft, lampRight, forward);
const front = lampLeft.clone().add(lampRight).multiplyScalar(0.5);
// Forward turned a quarter toward the truck's left (y up).
const leftOf = new Vector3(forward.z, 0, -forward.x);
if (lampLeft.clone().sub(front).dot(leftOf) < 0) {
  leftOf.negate();
}
const target = front.clone().addScaledVector(forward, -SHOT.back).addScaledVector(leftOf, SHOT.side);
target.y = SHOT.lookHeight;
const azimuth = (SHOT.azimuth * Math.PI) / 180;
const eye = target
  .clone()
  .addScaledVector(forward, Math.cos(azimuth) * SHOT.distance)
  .addScaledVector(leftOf, Math.sin(azimuth) * SHOT.distance);
eye.y = SHOT.eyeHeight;
const camera = new PerspectiveCamera(SHOT.fov, 1, 0.1, 500);
camera.position.copy(eye);
camera.lookAt(target);
camera.updateMatrixWorld();

// The glass mirrors its own blue sky, and the windscreen (the glass facing forward) gets two diagonal glare bands.
const glassSky = {
  skyZenith: { value: new Color(SHOT.glass.zenith) },
  skyHorizon: { value: new Color(SHOT.glass.horizon) },
  skyFacing: { value: SHOT.glass.facing },
};
scene.traverse((object) => {
  if (!(object instanceof Mesh) || !(object.material instanceof MeshPhongMaterial)) {
    return;
  }
  const material = object.material;
  if (material.color.getHex() !== GLASS_COLOR || material.userData['iconGlass'] === true) {
    return;
  }
  material.userData['iconGlass'] = true;
  const mirrorSky = material.onBeforeCompile;
  material.onBeforeCompile = (shader, webgl) => {
    mirrorSky.call(material, shader, webgl);
    Object.assign(shader.uniforms, glassSky);
    shader.uniforms['iconStreak'] = { value: SHOT.streak };
    shader.uniforms['iconFrontZ'] = { value: front.z };
    shader.fragmentShader = shader.fragmentShader
      .replace('uniform float skyStrength;', 'uniform float skyStrength;\nuniform float iconStreak;\nuniform float iconFrontZ;')
      .replace(
        'outgoingLight = mix( outgoingLight, skyColor, clamp( skyAmount, 0.0, 1.0 ) );',
        `outgoingLight = mix( outgoingLight, skyColor, clamp( skyAmount, 0.0, 1.0 ) );
        if ( vSkyWorld.z > iconFrontZ - 0.3 ) {
          float d = vSkyWorld.x * 0.75 + vSkyWorld.y - 2.75;
          float bands = ( 1.0 - smoothstep( 0.0, 0.16, abs( d ) ) ) * 0.55 + ( 1.0 - smoothstep( 0.0, 0.06, abs( d - 0.42 ) ) ) * 0.4;
          outgoingLight += vec3( 1.0 ) * bands * iconStreak;
        }`,
      );
  };
  material.customProgramCacheKey = () => 'icon-glass';
});

/**
 * The cab's outline as the store icon's camera sees it: every corner of the truck's model ahead of the cab's back
 * wall (the cab, its mirrors, bumper and front wheels), in the store frame's normalized units, as x, y pairs. The
 * soft shadow on the ground and the lamps' glows are not the cab.
 */
function cabOutline(): number[] {
  scene.updateMatrixWorld(true);
  const body = scene.getObjectByName('truck-body');
  const chassis = body?.parent;
  if (body === undefined || chassis === null || chassis === undefined) {
    throw new Error("TruckView's body (truck-body) is not in the scene.");
  }
  const cabRear = cab.frontZ - cab.cabLength;
  const toBody = body.matrixWorld.clone().invert();
  const instance = new Matrix4();
  const corner = new Vector3();
  const inBody = new Vector3();
  const points: number[] = [];
  chassis.traverseVisible((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }
    const positions = object.geometry.getAttribute('position');
    const instances = object instanceof InstancedMesh ? object.count : 1;
    for (let i = 0; i < instances; i++) {
      if (object instanceof InstancedMesh) {
        object.getMatrixAt(i, instance);
      } else {
        instance.identity();
      }
      for (let v = 0; v < positions.count; v++) {
        corner.fromBufferAttribute(positions, v).applyMatrix4(instance).applyMatrix4(object.matrixWorld);
        if (inBody.copy(corner).applyMatrix4(toBody).z >= cabRear) {
          corner.project(camera);
          points.push(corner.x, corner.y);
        }
      }
    }
  });
  return points;
}

/** The smallest circle round points (x, y pairs): round their convex hull, corner by corner. */
function enclosingCircle(xy: readonly number[]): { x: number; y: number; r: number } {
  const points: [number, number][] = [];
  for (let i = 0; i < xy.length; i += 2) {
    points.push([xy[i]!, xy[i + 1]!]);
  }
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  const upper: [number, number][] = [];
  for (const point of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  for (let i = points.length - 1; i >= 0; i--) {
    const point = points[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  const inside = (c: { x: number; y: number; r: number }, p: [number, number]): boolean =>
    Math.sqrt((p[0] - c.x) ** 2 + (p[1] - c.y) ** 2) <= c.r + 1e-9;
  const across = (a: [number, number], b: [number, number]): { x: number; y: number; r: number } => ({
    x: (a[0] + b[0]) / 2,
    y: (a[1] + b[1]) / 2,
    r: Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) / 2,
  });
  const through = (a: [number, number], b: [number, number], c: [number, number]): { x: number; y: number; r: number } => {
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    const a2 = a[0] ** 2 + a[1] ** 2;
    const b2 = b[0] ** 2 + b[1] ** 2;
    const c2 = c[0] ** 2 + c[1] ** 2;
    const x = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
    const y = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
    return { x, y, r: Math.sqrt((a[0] - x) ** 2 + (a[1] - y) ** 2) };
  };
  let circle = { x: hull[0]![0], y: hull[0]![1], r: 0 };
  for (let i = 1; i < hull.length; i++) {
    if (inside(circle, hull[i]!)) {
      continue;
    }
    circle = { x: hull[i]![0], y: hull[i]![1], r: 0 };
    for (let j = 0; j < i; j++) {
      if (inside(circle, hull[j]!)) {
        continue;
      }
      circle = across(hull[i]!, hull[j]!);
      for (let k = 0; k < j; k++) {
        if (!inside(circle, hull[k]!)) {
          circle = through(hull[i]!, hull[j]!, hull[k]!);
        }
      }
    }
  }
  return circle;
}

// The frame: the layer is the square round the cab's circle in which that circle is CAB_RADIUS of 54 units, cut
// from a wider picture taken from the same eye (a crop, so the truck keeps the store icon's perspective).
const cabCircle = enclosingCircle(cabOutline());
const half = (cabCircle.r * 54) / CAB_RADIUS;
const reach = Math.max(Math.abs(cabCircle.x) + half, Math.abs(cabCircle.y) + half);
camera.fov = (2 * Math.atan(reach * Math.tan((SHOT.fov * Math.PI) / 360)) * 180) / Math.PI;
const FULL = 10000;
const unit = FULL / (2 * reach);
camera.setViewOffset(FULL, FULL, (cabCircle.x - half + reach) * unit, (reach - cabCircle.y - half) * unit, 2 * half * unit, 2 * half * unit);

renderer.render(scene, camera);
const gl = renderer.getContext();
const bottomUp = new Uint8Array(SIZE * SIZE * 4);
gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
const stride = SIZE * 4;
const rows = new Uint8Array(bottomUp.length);
for (let y = 0; y < SIZE; y++) {
  rows.set(bottomUp.subarray((SIZE - 1 - y) * stride, (SIZE - y) * stride), y * stride);
}
let binary = '';
for (let i = 0; i < rows.length; i += 0x8000) {
  binary += String.fromCharCode(...rows.subarray(i, i + 0x8000));
}
window.launcherIcon = { pixels: btoa(binary), size: SIZE, frame: { x: cabCircle.x, y: cabCircle.y, half } };
