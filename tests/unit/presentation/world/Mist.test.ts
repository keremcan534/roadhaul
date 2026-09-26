import {
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Scene,
  ShaderLib,
  UniformsUtils,
  Vector3,
  type IUniform,
  type Material,
  type WebGLRenderer,
} from 'three';
import { describe, expect, it } from 'vitest';
import { unlitByLamps } from '../../../../src/presentation/world/LampLighting';
import { Mist, MIST_DENSITY, MIST_GLSL, MIST_THICKNESS_METERS, mistShader } from '../../../../src/presentation/world/Mist';

type Shader = { uniforms: Record<string, IUniform>; vertexShader: string; fragmentShader: string };

/** `material`'s shaders as three.js hands them to onBeforeCompile (`kind`: its ShaderLib entry). */
function compiled(material: Material, kind: 'lambert' | 'basic' = 'lambert'): Shader {
  const shader: Shader = {
    uniforms: UniformsUtils.clone(ShaderLib[kind].uniforms) as Record<string, IUniform>,
    vertexShader: ShaderLib[kind].vertexShader,
    fragmentShader: ShaderLib[kind].fragmentShader,
  };
  material.onBeforeCompile(shader as never, {} as WebGLRenderer);
  return shader;
}

/**
 * mistAmount() as the GLSL works it out (MIST_GLSL), for the numbers: the
 * density at the eye's height times the line's length, times the mean of
 * the falloff between the eye's height and the point's.
 */
function mistAmount(eyeHeight: number, offset: Vector3, density: number): number {
  const eye = Math.max(eyeHeight, -2) / MIST_THICKNESS_METERS;
  const end = Math.max(eyeHeight + offset.y, -2) / MIST_THICKNESS_METERS;
  const rise = end - eye;
  const mean = Math.abs(rise) < 1e-3 ? Math.exp(-eye) * (1 - 0.5 * rise) : (Math.exp(-eye) - Math.exp(-end)) / rise;
  return 1 - Math.exp(-density * offset.length() * mean);
}

/** The same, the density summed step by step along the line. */
function mistByStepping(eyeHeight: number, offset: Vector3, density: number): number {
  const steps = 20000;
  let depth = 0;
  for (let i = 0; i < steps; i++) {
    const height = eyeHeight + offset.y * ((i + 0.5) / steps);
    depth += density * Math.exp(-Math.max(height, -2) / MIST_THICKNESS_METERS) * (offset.length() / steps);
  }
  return 1 - Math.exp(-depth);
}

describe('Mist', () => {
  it('lays the mist over what takes the fog, right after the fog, from where each point is from the camera', () => {
    const mist = new Mist();
    const lit = new MeshLambertMaterial();
    const prelit = new MeshBasicMaterial();
    const scene = new Scene();
    scene.add(new Mesh(new BoxGeometry(), lit), new Mesh(new BoxGeometry(), prelit));
    mist.shadeScene(scene);

    for (const shader of [compiled(lit), compiled(prelit, 'basic')]) {
      expect(shader.vertexShader).toContain('vMistOffset = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;');
      const fragment = shader.fragmentShader;
      expect(fragment).toContain(MIST_GLSL);
      expect(fragment.indexOf('mistAmount( vMistOffset )')).toBeGreaterThan(fragment.indexOf('#include <fog_fragment>'));
      // The fog comes after the colour is ready for its target: the mist's light is made ready the same way.
      expect(fragment).toContain('mistShade = toneMapping( mistShade );');
      expect(fragment).toContain('linearToOutputTexel( vec4( mistShade, 1.0 ) )');
      // Shared: set() reaches every material at once.
      expect(shader.uniforms['mistDensity']).toBe(mist.uniforms.mistDensity);
    }
    expect(lit.customProgramCacheKey()).toContain('mist');
  });

  it('chains after what a material does to its shaders already, once however often the scene is shaded', () => {
    const material = new MeshLambertMaterial();
    let before = 0;
    material.onBeforeCompile = (shader) => {
      before++;
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n// own');
    };
    material.customProgramCacheKey = () => 'own';
    const mesh = new Mesh(new BoxGeometry(), material);
    const mist = new Mist();
    mist.shadeScene(mesh);
    mist.shadeScene(mesh);

    const shader = compiled(material);
    expect(before).toBe(1);
    expect(shader.fragmentShader).toContain('// own');
    expect(shader.fragmentShader.match(/varying vec3 vMistOffset;/g)).toHaveLength(1);
    expect(material.customProgramCacheKey()).toBe('own|mist');
  });

  it("leaves the sky's backdrop and shaders without the fog alone", () => {
    const backdrop = new Mesh(new BoxGeometry(), new MeshLambertMaterial());
    unlitByLamps(backdrop);
    new Mist().shadeScene(backdrop);
    expect((backdrop.material as Material).customProgramCacheKey()).not.toContain('mist');

    const own = { uniforms: {}, vertexShader: 'void main() {}', fragmentShader: 'void main() {}' };
    mistShader(own, new Mist().uniforms);
    expect(own).toEqual({ uniforms: {}, vertexShader: 'void main() {}', fragmentShader: 'void main() {}' });
  });

  it('lies as thick as asked, its light and its glow toward the sun as given', () => {
    const mist = new Mist();
    const towardSun = new Vector3(1, 0.1, 0).normalize();
    mist.set(0.5, new Color(0.5, 0.6, 0.7), new Color(1, 0.8, 0.5), towardSun);
    expect(mist.uniforms.mistDensity.value).toBeCloseTo(0.5 * MIST_DENSITY, 12);
    expect(mist.uniforms.mistColor.value.toArray()).toEqual([0.5, 0.6, 0.7]);
    expect(mist.uniforms.mistGlow.value.toArray()).toEqual([1, 0.8, 0.5]);
    expect(mist.uniforms.mistSun.value.equals(towardSun)).toBe(true);
    mist.set(3, new Color(), new Color(), towardSun);
    expect(mist.uniforms.mistDensity.value).toBe(MIST_DENSITY);
    mist.set(0, new Color(), new Color(), towardSun);
    expect(mist.uniforms.mistDensity.value).toBe(0);
  });

  it('hides the far land from the cab and the feet of what stands in it, while treetops and hills rise out of it', () => {
    const eye = 3;
    const lost = (x: number, y: number) => mistAmount(eye, new Vector3(x, y - eye, 0), MIST_DENSITY);
    // Along the ground: little close by, most of it far off.
    expect(lost(40, 0)).toBeGreaterThan(0.1);
    expect(lost(40, 0)).toBeLessThan(0.25);
    expect(lost(120, 0)).toBeGreaterThan(0.35);
    expect(lost(300, 0)).toBeGreaterThan(0.7);
    // A tree 150 m off: its foot deep in the mist, its top out of the worst of it; a hill's ridge far clearer than its foot.
    expect(lost(150, 12)).toBeLessThan(lost(150, 0) * 0.6);
    expect(lost(600, 50)).toBeLessThan(0.3);
    expect(lost(600, 0)).toBeGreaterThan(0.9);
    // The closed form is the density summed along the line, up, down and level.
    for (const [x, y] of [
      [120, 0],
      [150, 12],
      [600, 50],
      [80, 3],
      [30, -1],
    ] as const) {
      const offset = new Vector3(x, y - eye, 0);
      expect(mistAmount(eye, offset, MIST_DENSITY)).toBeCloseTo(mistByStepping(eye, offset, MIST_DENSITY), 4);
    }
  });
});
