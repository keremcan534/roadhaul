import { Color, ShaderMaterial, UniformsLib, UniformsUtils } from 'three';
import type { SkyUniforms } from './EnvironmentView';

/**
 * The sun (or the moon) glitters on the water: the waves are covered in
 * small facets, this many to a meter each way, each tilted its own way by
 * up to this much (a slope) and turning over this many times a second, and
 * the few that catch the light just right flash, as bright as this (times
 * the sun's colour). Toward a low sun they lay a glittering path on it.
 */
const SPARKLE_CELLS_PER_METER = 2.5;
const SPARKLE_TILT = 0.16;
const SPARKLE_RATE = 0.7;
const SPARKLE_SHARPNESS = 700;
const SPARKLE_LEVEL = 9;
/** A river's ripples ride its current downstream this fast, meters a second. */
const RIVER_CURRENT_METERS_PER_SECOND = 0.7;

export interface WaterMaterialOptions {
  /** The sky it mirrors (EnvironmentView.sky). */
  readonly sky: SkyUniforms;
  /** Seconds, advanced by its view: the waves and the foam move with it. */
  readonly time: { value: number };
  /** The water's own colour before the sky's reflection. */
  readonly deepColor: number;
  /**
   * A river: the ripples ride the current along the mesh's `flow` attribute
   * (meters across and along the river), and the foam is fainter; it lies in
   * its channel below the fields. Otherwise the sea: ripples in the world's
   * own frame, and it lies on the ground under the roads.
   */
  readonly river?: boolean;
}

/**
 * The water's shader, shared by the sea (SeaView) and the rivers
 * (RiverView): small ripples drift across it, the sky shows in it more at
 * grazing angles, the sun (at night the moon) glitters on it and sparkles
 * on facets that catch it, and foam breaks where the mesh's `shore`
 * attribute (meters from the water's edge) is small. Fogged like the rest
 * of the scene.
 */
export function createWaterMaterial(options: WaterMaterialOptions): ShaderMaterial {
  const { sky, time, deepColor } = options;
  const river = options.river === true;
  return new ShaderMaterial({
    fog: true,
    defines: river ? { RIVER: '' } : {},
    // The sea lies on the ground, under the roads; a river's water lies in its channel, well below.
    polygonOffset: !river,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: {
      ...UniformsUtils.clone(UniformsLib.fog),
      zenith: sky.zenith,
      horizon: sky.horizon,
      sunColor: sky.sunColor,
      sunDirection: sky.sunDirection,
      deepColor: { value: new Color(deepColor) },
      time,
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      attribute float shore;
      varying vec3 vWorld;
      varying float vShore;
      #ifdef RIVER
        attribute vec2 flow;
        varying vec2 vFlow;
      #endif
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vShore = shore;
        #ifdef RIVER
          vFlow = flow;
        #endif
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 zenith;
      uniform vec3 horizon;
      uniform vec3 sunColor;
      uniform vec3 sunDirection;
      uniform vec3 deepColor;
      uniform float time;
      varying vec3 vWorld;
      varying float vShore;
      #ifdef RIVER
        varying vec2 vFlow;
      #endif
      // One ripple: its slope along x and z where it passes p.
      vec2 ripple(vec2 p, vec2 k, float speed, float height) {
        return k * (height * cos(dot(p, k) + time * speed));
      }
      // A hash of a cell, 0..1, steady on large coordinates.
      float cellHash(vec2 cell) {
        vec3 q = fract(vec3(cell.xyx) * 0.1031);
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
      }
      void main() {
        #ifdef RIVER
          // Across and along the river, the ripples carried downstream by the current.
          vec2 p = vec2(vFlow.x, vFlow.y - time * ${RIVER_CURRENT_METERS_PER_SECOND.toFixed(2)});
        #else
          vec2 p = vWorld.xz;
        #endif
        vec2 slope = ripple(p, vec2(0.21, 0.09), 1.1, 0.16)
          + ripple(p, vec2(-0.11, 0.26), 1.5, 0.12)
          + ripple(p, vec2(0.43, -0.31), 2.3, 0.05)
          + ripple(p, vec2(-0.07, -0.67), 3.1, 0.03);
        vec3 toEye = cameraPosition - vWorld;
        // Far off, the ripples are finer than a pixel: they average out into calm water instead of stripes.
        slope *= 0.3 + 0.7 * (1.0 - smoothstep(60.0, 450.0, length(toEye)));
        toEye = normalize(toEye);
        vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
        // The sky shows in the water, the more the flatter it is seen.
        float fresnel = 0.02 + 0.68 * pow(1.0 - max(dot(normal, toEye), 0.0), 5.0);
        vec3 mirrored = reflect(-toEye, normal);
        vec3 sky = mix(horizon * 0.85, zenith, pow(clamp(mirrored.y, 0.0, 1.0), 0.5));
        float daylight = dot(horizon, vec3(0.2126, 0.7152, 0.0722));
        vec3 color = mix(deepColor * (0.25 + daylight), sky, fresnel);
        // The sun (or the moon) glitters on the ripples...
        color += sunColor * pow(max(dot(mirrored, sunDirection), 0.0), 180.0) * 2.5;
        // ...and sparkles on the facets that catch it: one a cell, tilted its own way as it turns over, a round
        // point of light while it faces the sun just right. Not once the sun's disc has set.
        vec2 cells = p * ${SPARKLE_CELLS_PER_METER.toFixed(2)};
        vec2 cell = floor(cells);
        float seed = cellHash(cell);
        float turn = fract(time * ${SPARKLE_RATE.toFixed(2)} + seed) * 6.2832;
        vec2 tilt = (vec2(cellHash(cell + 31.7), cellHash(cell + 71.3)) * 2.0 - 1.0) * ${SPARKLE_TILT.toFixed(2)};
        vec3 facet = normalize(vec3(-slope.x - tilt.x * cos(turn), 1.0, -slope.y - tilt.y * sin(turn)));
        float glint = pow(max(dot(reflect(-toEye, facet), sunDirection), 0.0), ${SPARKLE_SHARPNESS.toFixed(1)});
        float point = 1.0 - smoothstep(0.1, 0.4, length(cells - cell - 0.5));
        color += sunColor * (glint * point * ${SPARKLE_LEVEL.toFixed(1)} * smoothstep(-0.01, 0.03, sunDirection.y));
        // Foam where the ripples break on the shore, coming and going; a river's only laps at its banks.
        float surf = 0.6 + 0.4 * sin(time * 1.7 - vShore * 1.8 + slope.x * 6.0);
        #ifdef RIVER
          float foam = (1.0 - smoothstep(0.0, 1.5, vShore)) * surf * 0.5;
        #else
          float foam = (1.0 - smoothstep(0.0, 3.0, vShore)) * surf;
        #endif
        color = mix(color, vec3(0.86, 0.9, 0.92) * (0.25 + daylight), clamp(foam, 0.0, 1.0) * 0.75);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}
