import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  ShaderLib,
  ShaderMaterial,
  UniformsUtils,
  Vector3,
  type IUniform,
  type Material,
  type WebGLRenderer,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  LAMP_PICK_AHEAD_METERS,
  LampLighting,
  MAX_STREET_LAMPS,
  MAX_TRAFFIC_VEHICLES,
  scattersLamplight,
  unlitByLamps,
  type Headlamps,
  type TrafficHeadlamps,
} from '../../../../src/presentation/world/LampLighting';
import { PrelitMaterials } from '../../../../src/presentation/world/lighting';

const LIBRARY: Readonly<Record<string, (typeof ShaderLib)['basic']>> = {
  MeshBasicMaterial: ShaderLib.basic,
  MeshLambertMaterial: ShaderLib.lambert,
  MeshPhongMaterial: ShaderLib.phong,
  MeshStandardMaterial: ShaderLib.standard,
};

interface Shader {
  uniforms: Record<string, IUniform>;
  vertexShader: string;
  fragmentShader: string;
}

/** What three.js's own shaders for `material` become once its onBeforeCompile has run. */
function compiled(material: Material): Shader {
  const library = LIBRARY[material.type]!;
  const shader: Shader = {
    uniforms: UniformsUtils.clone(library.uniforms),
    vertexShader: library.vertexShader,
    fragmentShader: library.fragmentShader,
  };
  material.onBeforeCompile(shader as unknown as Parameters<Material['onBeforeCompile']>[0], {} as WebGLRenderer);
  return shader;
}

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

function meshOf(material: Material | Material[]): Mesh {
  return new Mesh(new BoxGeometry(), material);
}

/** A truck standing at the origin facing +Z, its lamps either side of its nose. */
const TRUCK: Headlamps = {
  headlamps(left, right, forward) {
    left.set(0.9, 0.8, 3.2);
    right.set(-0.9, 0.8, 3.2);
    forward.set(0, 0, 1);
  },
};

function cameraAt(x: number, y: number, z: number, lookAt: Vector3): PerspectiveCamera {
  const camera = new PerspectiveCamera();
  camera.position.set(x, y, z);
  camera.lookAt(lookAt);
  return camera;
}

function expectClose(actual: Vector3, expected: Vector3): void {
  expect(actual.x).toBeCloseTo(expected.x, 5);
  expect(actual.y).toBeCloseTo(expected.y, 5);
  expect(actual.z).toBeCloseTo(expected.z, 5);
}

describe('LampLighting', () => {
  it('adds the lamps to the lit materials as more lights, and to the pre-lit ones on their own colour, once each', () => {
    const prelit = new PrelitMaterials();
    const lighting = new LampLighting();
    const lambert = new MeshLambertMaterial();
    const phong = new MeshPhongMaterial();
    const standard = new MeshStandardMaterial();
    const ground = prelit.add(new MeshBasicMaterial());
    const plain = new MeshBasicMaterial();
    const custom = new ShaderMaterial();
    const root = new Group();
    const nested = new Group();
    nested.add(meshOf([phong, standard]));
    root.add(meshOf(lambert), meshOf(ground), meshOf(plain), meshOf(custom), nested);

    lighting.lightScene(root, prelit);
    lighting.lightScene(root, prelit);

    for (const material of [lambert, phong, standard]) {
      const shader = compiled(material);
      expect(occurrences(shader.fragmentShader, 'float lowBeam('), material.type).toBe(1);
      // Each lamp through the material's own lighting, after three's lights.
      expect(shader.fragmentShader.indexOf('RE_Direct( lamp')).toBeGreaterThan(shader.fragmentShader.indexOf('#include <lights_fragment_begin>'));
      expect(shader.uniforms['lampLevel']).toBe(lighting.uniforms.lampLevel);
      expect(material.customProgramCacheKey()).toMatch(/\|lamplit$/);
    }
    const shader = compiled(ground);
    expect(occurrences(shader.fragmentShader, 'float lowBeam(')).toBe(1);
    expect(shader.vertexShader).toContain('vLampView = mvPosition.xyz;');
    // On the pre-lit colour turned back into the surface's own, before the rain's wet sheen touches it.
    expect(shader.fragmentShader.indexOf('prelitAlbedo * (')).toBeGreaterThan(shader.fragmentShader.indexOf('#include <envmap_fragment>'));
    expect(shader.fragmentShader).not.toContain('#define LAMPS_SCATTER');
    expect(shader.uniforms['prelitAlbedo']).toBe(prelit.albedo);
    expect(shader.uniforms['truckLamps']).toBe(lighting.uniforms.truckLamps);
    expect(ground.customProgramCacheKey()).toMatch(/\|lamplit-ground$/);
    // Unlit materials that are not pre-lit (lamps, glass, the cab's inside) and custom shaders stay as they are.
    expect(compiled(plain).fragmentShader).not.toContain('lowBeam');
    expect(custom.customProgramCacheKey()).not.toContain('lamplit');
  });

  it('keeps what a material did to its shaders already, and its program apart from the same material without the lamps', () => {
    const prelit = new PrelitMaterials();
    const lighting = new LampLighting();
    const swaying = new MeshLambertMaterial();
    swaying.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n// sway');
    };
    swaying.customProgramCacheKey = () => 'sway';
    const grass = prelit.add(new MeshBasicMaterial());
    scattersLamplight(grass);

    lighting.lightScene(meshOf([swaying, grass]), prelit);

    const shader = compiled(swaying);
    expect(shader.vertexShader).toContain('// sway');
    expect(shader.fragmentShader).toContain('float lowBeam(');
    expect(swaying.customProgramCacheKey()).toBe('sway|lamplit');
    // Plants scatter the light every way.
    expect(compiled(grass).fragmentShader).toContain('#define LAMPS_SCATTER');
    expect(grass.customProgramCacheKey()).toMatch(/\|lamplit-scatter$/);
  });

  it('leaves out what is marked unlit by the lamps: an object and everything under it, or a material', () => {
    const prelit = new PrelitMaterials();
    const lighting = new LampLighting();
    const sky = new MeshLambertMaterial();
    const hills = prelit.add(new MeshBasicMaterial());
    const backdrop = new Group();
    backdrop.add(meshOf(sky), new Group().add(meshOf(hills)));
    unlitByLamps(backdrop);
    const marked = new MeshPhongMaterial();
    unlitByLamps(marked);
    const root = new Group().add(backdrop, meshOf(marked));

    lighting.lightScene(root, prelit);

    for (const material of [sky, hills, marked]) {
      expect(compiled(material).fragmentShader, material.type).not.toContain('lowBeam');
    }
  });

  it("moves the truck's lamps into the camera's view every frame, facing the way it does, level; off by day", () => {
    const lighting = new LampLighting();
    const camera = cameraAt(-4, 6, -12, new Vector3(0, 1, 10));
    const u = lighting.uniforms;

    lighting.update(TRUCK, null, camera, 1);

    const view = camera.matrixWorldInverse;
    expect(u.lampLevel.value).toBe(1);
    expectClose(u.truckLamps.value[0]!, new Vector3(0.9, 0.8, 3.2).applyMatrix4(view));
    expectClose(u.truckLamps.value[1]!, new Vector3(-0.9, 0.8, 3.2).applyMatrix4(view));
    expectClose(u.truckForward.value, new Vector3(0, 0, 1).transformDirection(view));
    // Facing +Z, its right is −X.
    expectClose(u.truckRight.value, new Vector3(-1, 0, 0).transformDirection(view));
    expectClose(u.lampUp.value, new Vector3(0, 1, 0).transformDirection(view));

    // Nose down on a slope, the beam still faces level ahead.
    const pitched: Headlamps = {
      headlamps(left, right, forward) {
        TRUCK.headlamps(left, right, forward);
        forward.set(0, -0.2, 0.98);
      },
    };
    lighting.update(pitched, null, camera, 0.5);
    expect(u.lampLevel.value).toBe(0.5);
    expectClose(u.truckForward.value, new Vector3(0, 0, 1).transformDirection(view));

    lighting.update(TRUCK, null, camera, 0);
    expect(u.lampLevel.value).toBe(0);
  });

  it('lights by the street lamps nearest a point ahead of the camera, fading those far off, and the farthest as the next one comes as near', () => {
    const lighting = new LampLighting();
    const u = lighting.uniforms;
    // The camera looks along +X from x = 0: the lamps are picked round x = 20. Down the road, 5 m apart either way
    // from there, each facing across it (−Z); the ninth only 2 m further off than the eighth.
    const offsets = [0, 5, -5, 10, -10, 15, -15, 20, 22];
    const lamps = offsets.map((offset) => ({ x: LAMP_PICK_AHEAD_METERS + offset, y: 7.4, z: 3, facingX: 0, facingZ: -1 }));
    lighting.setStreetLamps(lamps);
    const camera = cameraAt(0, 5, 3, new Vector3(50, 0, 3));

    lighting.update(TRUCK, null, camera, 1);

    expect(MAX_STREET_LAMPS).toBe(8);
    expect(u.streetLampCount.value).toBe(8);
    const view = camera.matrixWorldInverse;
    // The nearest first: the one at the pick point, the one 20 m off last.
    expectClose(u.streetLamps.value[0]!, new Vector3(LAMP_PICK_AHEAD_METERS, 7.4, 3).applyMatrix4(view));
    expectClose(u.streetLamps.value[7]!, new Vector3(LAMP_PICK_AHEAD_METERS + 20, 7.4, 3).applyMatrix4(view));
    expectClose(u.streetLampFacing.value[0]!, new Vector3(0, 0, -1).transformDirection(view));
    expect(u.streetLampFade.value.slice(0, 7)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    // It makes way for the next one out, 2 m further: a fifth of the 10 m it takes.
    expect(u.streetLampFade.value[7]).toBeCloseTo(0.2, 6);

    // Far off, the lamps fade out: none past 90 m.
    const farCamera = cameraAt(80, 5, 3, new Vector3(300, 0, 3));
    lighting.update(TRUCK, null, farCamera, 1);
    // Round x = 100: the lamp at x = 42, 58 m off, whole; the one at x = 15, 85 m off, a sixth of the way from 90 m
    // to 60 m; those at x = 10 and 5, 90 m off and more, not at all.
    expect(u.streetLampCount.value).toBe(7);
    const fades = u.streetLampFade.value.slice(0, 7);
    expect(fades[0]).toBe(1);
    expect(fades[6]).toBeCloseTo(1 / 6, 6);
    lighting.update(TRUCK, null, cameraAt(300, 5, 3, new Vector3(500, 0, 3)), 1);
    expect(u.streetLampCount.value).toBe(0);

    // Fewer on weaker devices.
    const fewer = new LampLighting({ streetLamps: 3 });
    fewer.setStreetLamps(lamps);
    fewer.update(TRUCK, null, camera, 1);
    expect(fewer.uniforms.streetLampCount.value).toBe(3);
    // The third, 5 m off, half-way to making way for the next, 10 m off.
    expect(fewer.uniforms.streetLampFade.value[2]).toBeCloseTo(0.5, 6);
  });

  it('picks the lamps the camera sees: ahead of it rather than behind it', () => {
    const lighting = new LampLighting({ streetLamps: 1 });
    // 15 m behind the camera, and 25 m ahead of it.
    lighting.setStreetLamps([-15, 25].map((x) => ({ x, y: 7.4, z: 0, facingX: 0, facingZ: 1 })));
    const camera = cameraAt(0, 5, 0, new Vector3(10, 0, 0));

    lighting.update(TRUCK, null, camera, 1);

    expect(lighting.uniforms.streetLampCount.value).toBe(1);
    expectClose(lighting.uniforms.streetLamps.value[0]!, new Vector3(25, 7.4, 0).applyMatrix4(camera.matrixWorldInverse));
  });

  it('lights by the headlights of the vehicles nearest the camera, as bright as the traffic says', () => {
    const asked: number[] = [];
    const traffic: TrafficHeadlamps = {
      headlampsNear(x, z, reach, lamps, forwards, strengths) {
        asked.push(strengths.length);
        // Round the point 20 m ahead of the camera.
        expect(x).toBeCloseTo(10, 9);
        expect(z).toBeCloseTo(-20 + LAMP_PICK_AHEAD_METERS, 9);
        expect(reach).toBeGreaterThan(100);
        const vehicles = Math.min(strengths.length, 2);
        for (let v = 0; v < vehicles; v++) {
          lamps[v * 2]!.set(v * 10 + 0.8, 0.7, 40);
          lamps[v * 2 + 1]!.set(v * 10 - 0.8, 0.7, 40);
          // Oncoming: facing −Z.
          forwards[v]!.set(0, 0, -1);
          strengths[v] = v === 0 ? 1 : 0.4;
        }
        return vehicles;
      },
    };
    const lighting = new LampLighting();
    const u = lighting.uniforms;
    const camera = cameraAt(10, 4, -20, new Vector3(10, 1, 20));

    lighting.update(TRUCK, traffic, camera, 1);

    expect(asked).toEqual([MAX_TRAFFIC_VEHICLES]);
    expect(u.trafficLampCount.value).toBe(4);
    const view = camera.matrixWorldInverse;
    expectClose(u.trafficLamps.value[0]!, new Vector3(0.8, 0.7, 40).applyMatrix4(view));
    expectClose(u.trafficLamps.value[3]!, new Vector3(9.2, 0.7, 40).applyMatrix4(view));
    expectClose(u.trafficForward.value[1]!, new Vector3(0, 0, -1).transformDirection(view));
    expectClose(u.trafficRight.value[1]!, new Vector3(1, 0, 0).transformDirection(view));
    expect(u.trafficStrength.value).toEqual([1, 0.4]);

    // No traffic, or none on weaker devices.
    lighting.update(TRUCK, null, camera, 1);
    expect(u.trafficLampCount.value).toBe(0);
    const without = new LampLighting({ trafficVehicles: 0 });
    without.update(TRUCK, traffic, camera, 1);
    expect(without.uniforms.trafficLampCount.value).toBe(0);
    expect(asked).toHaveLength(1);
  });
});
