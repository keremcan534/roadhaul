import { Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, PlaneGeometry, ShaderLib, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { CloudShadows } from '../../../../src/presentation/world/cloudShadows';
import { unlitByLamps } from '../../../../src/presentation/world/LampLighting';
import { PrelitMaterials, sunShareOfGroundLight } from '../../../../src/presentation/world/lighting';

/** What `material`'s shaders become: its own (ShaderLib's `lib`) through its onBeforeCompile. */
function compiled(material: Material, lib: 'basic' | 'lambert' | 'standard'): { vertexShader: string; fragmentShader: string; uniforms: Record<string, unknown> } {
  const { vertexShader, fragmentShader } = ShaderLib[lib];
  const shader = { vertexShader, fragmentShader, uniforms: {} as Record<string, unknown> };
  material.onBeforeCompile(shader as never, undefined as never);
  return shader;
}

function scene(...materials: Material[]): Group {
  const root = new Group();
  for (const material of materials) {
    root.add(new Mesh(new PlaneGeometry(1, 1), material));
  }
  return root;
}

describe('CloudShadows', () => {
  it('shades part of the land under broken cloud, darker the stronger the sun, none under a sky all cloud', () => {
    const clouds = new CloudShadows();
    const { cloudShare, cloudDarkness, cloudGroundDarkness } = clouds.uniforms;

    clouds.setClouds(0.55, 0.6);
    const broken = { share: cloudShare.value, darkness: cloudDarkness.value, ground: cloudGroundDarkness.value };
    expect(broken.share).toBeGreaterThan(0.1);
    expect(broken.darkness).toBeGreaterThan(0.4);
    expect(broken.ground).toBeCloseTo(broken.darkness * 0.6, 9);

    clouds.setClouds(1, 0.6);
    expect(cloudDarkness.value).toBe(0);
    clouds.setClouds(0.55, 0);
    expect(cloudGroundDarkness.value).toBe(0);
    clouds.setClouds(0.2, 0.6);
    expect(cloudShare.value).toBeLessThan(broken.share);
    clouds.dispose();
  });

  it('drifts with the wind, round and round its picture', () => {
    const clouds = new CloudShadows();
    const offset = clouds.uniforms.cloudOffset.value;

    clouds.drift(10);
    const moved = offset.clone();
    expect(moved.length()).toBeGreaterThan(30);
    clouds.drift(0);
    expect(offset.equals(moved)).toBe(true);
    for (let i = 0; i < 1000; i++) {
      clouds.drift(10);
    }
    expect(Math.abs(offset.x)).toBeLessThan(1400);
    expect(Math.abs(offset.y)).toBeLessThan(1400);
  });

  it("dims the pre-lit ground by the sun's share of its light, and lit things in their direct light, once each", () => {
    const clouds = new CloudShadows();
    const prelit = new PrelitMaterials();
    const ground = prelit.add(new MeshBasicMaterial());
    const unlisted = new MeshBasicMaterial();
    const tree = new MeshLambertMaterial();
    const paint = new MeshStandardMaterial();
    const root = scene(ground, unlisted, tree, paint);

    clouds.shadeScene(root, prelit);
    clouds.shadeScene(root, prelit);

    const groundShader = compiled(ground, 'basic');
    expect(groundShader.vertexShader).toContain('vCloudGround = ( modelMatrix * cloudGround ).xz;');
    expect(groundShader.fragmentShader).toContain('outgoingLight *= 1.0 - cloudGroundDarkness * cloudShade( vCloudGround );');
    expect(groundShader.fragmentShader.indexOf('cloudGroundDarkness * cloudShade')).toBeLessThan(groundShader.fragmentShader.indexOf('#include <envmap_fragment>'));
    expect(groundShader.uniforms['cloudMap']).toBe(clouds.uniforms.cloudMap);
    // Once: the second pass chained nothing more.
    expect(groundShader.fragmentShader.split('cloudGroundDarkness * cloudShade').length).toBe(2);
    expect(ground.customProgramCacheKey()).toContain('clouds-prelit');
    // Not pre-lit: left alone.
    expect(compiled(unlisted, 'basic').fragmentShader).not.toContain('cloudShade');
    for (const [material, lib] of [
      [tree, 'lambert'],
      [paint, 'standard'],
    ] as const) {
      const shader = compiled(material, lib);
      expect(shader.fragmentShader).toContain('reflectedLight.directDiffuse *= cloudLight;');
      expect(shader.fragmentShader.indexOf('cloudLight')).toBeGreaterThan(shader.fragmentShader.indexOf('#include <lights_fragment_end>'));
      // The world position from the view's: the vertices stay as the view made them.
      expect(shader.vertexShader).toBe(ShaderLib[lib].vertexShader);
      expect(material.customProgramCacheKey()).toContain('clouds-lit');
    }
    clouds.dispose();
  });

  it("keeps what the views did to the shaders, and leaves the sky's backdrop out", () => {
    const clouds = new CloudShadows();
    const prelit = new PrelitMaterials();
    const swaying = new MeshLambertMaterial();
    swaying.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n// swayed');
    };
    swaying.customProgramCacheKey = () => 'swaying';
    const hills = new MeshLambertMaterial();
    const backdrop = scene(hills);
    unlitByLamps(backdrop);
    const root = scene(swaying);
    root.add(backdrop);

    clouds.shadeScene(root, prelit);

    const shader = compiled(swaying, 'lambert');
    expect(shader.vertexShader).toContain('// swayed');
    expect(shader.fragmentShader).toContain('cloudLight');
    expect(swaying.customProgramCacheKey()).toBe('swaying|clouds-lit');
    expect(compiled(hills, 'lambert').fragmentShader).not.toContain('cloudLight');
    clouds.dispose();
  });
});

describe('sunShareOfGroundLight', () => {
  it("is the sun's part of the light on flat ground: most of a clear day's, none without it", () => {
    const clearDay = sunShareOfGroundLight(1, 1);

    expect(clearDay).toBeGreaterThan(0.5);
    expect(clearDay).toBeLessThan(0.9);
    expect(sunShareOfGroundLight(0, 1)).toBe(0);
    expect(sunShareOfGroundLight(1, 0)).toBe(1);
    expect(sunShareOfGroundLight(0.3, 1)).toBeLessThan(clearDay);
    expect(sunShareOfGroundLight(0, 0)).toBe(0);
  });
});
