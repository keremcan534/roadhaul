import { MeshLambertMaterial, MeshPhongMaterial, Scene, ShaderLib } from 'three';
import { describe, expect, it } from 'vitest';
import { EnvironmentView } from '../../../../src/presentation/world/EnvironmentView';
import { reflectSky } from '../../../../src/presentation/world/skyReflection';

/** What three.js hands onBeforeCompile for a material of `kind`. */
function shaderOf(kind: 'lambert' | 'phong') {
  return {
    uniforms: {} as Record<string, unknown>,
    vertexShader: ShaderLib[kind].vertexShader,
    fragmentShader: ShaderLib[kind].fragmentShader,
  };
}

describe('reflectSky', () => {
  it('mirrors the sky from its shared uniforms, before the light is written out', () => {
    const sky = new EnvironmentView(new Scene()).sky;
    for (const kind of ['lambert', 'phong'] as const) {
      const material = kind === 'lambert' ? new MeshLambertMaterial() : new MeshPhongMaterial();
      expect(reflectSky(material, sky, { facing: 0.05 })).toBe(material);
      const shader = shaderOf(kind);

      material.onBeforeCompile(shader as never, undefined as never);

      // The weather's own uniforms: the reflections follow it with nothing to update.
      expect(shader.uniforms['skyZenith']).toBe(sky.zenith);
      expect(shader.uniforms['skyHorizon']).toBe(sky.horizon);
      expect(shader.uniforms['skySunColor']).toBe(sky.sunColor);
      expect(shader.uniforms['skySunDirection']).toBe(sky.sunDirection);
      expect(shader.uniforms['skyFacing']).toEqual({ value: 0.05 });
      expect(shader.uniforms['skyStrength']).toEqual({ value: 1 });
      expect(shader.vertexShader).toContain('vSkyWorld = ( modelMatrix * skyWorld ).xyz;');
      const fragment = shader.fragmentShader;
      expect(fragment.indexOf('reflect( skyView, skyNormal )')).toBeGreaterThan(0);
      expect(fragment.indexOf('reflect( skyView, skyNormal )')).toBeLessThan(fragment.indexOf('#include <opaque_fragment>'));
      expect(fragment).not.toContain('#define SKY_METAL');
    }
  });

  it('tints a metal\'s reflection, reads per-vertex shine when asked, and keeps their programs apart', () => {
    const sky = new EnvironmentView(new Scene()).sky;
    const paint = reflectSky(new MeshPhongMaterial(), sky, { facing: 0.05 });
    const chrome = reflectSky(new MeshPhongMaterial(), sky, { facing: 0.85, metal: true, strength: 0.5 });
    const traffic = reflectSky(new MeshLambertMaterial(), sky, { facing: 0.05, perVertex: true });
    const chromeShader = shaderOf('phong');
    const trafficShader = shaderOf('lambert');

    chrome.onBeforeCompile(chromeShader as never, undefined as never);
    traffic.onBeforeCompile(trafficShader as never, undefined as never);

    expect(chromeShader.fragmentShader).toContain('#define SKY_METAL');
    expect(chromeShader.uniforms['skyStrength']).toEqual({ value: 0.5 });
    expect(trafficShader.vertexShader).toContain('attribute float shine;');
    expect(trafficShader.fragmentShader).toContain('#define SKY_SHINE');
    const keys = new Set([paint, chrome, traffic].map((material) => material.customProgramCacheKey()));
    expect(keys.size).toBe(3);
  });
});
