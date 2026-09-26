import {
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  Vector2,
  type Material,
  type Object3D,
} from 'three';
import { smoothstep } from '../../core/math/scalar';
import { cloudShadowImage } from '../textures/proceduralImages';
import { toTexture } from '../textures/toTexture';
import { isUnlitByLamps } from './LampLighting';
import type { PrelitMaterials } from './lighting';

/**
 * The clouds' shadows: their picture (a tileable noise) covers this many
 * meters square and drifts with the wind this fast (m/s, x and z); broken
 * cloud shades up to this share of the land, and a cloud's shadow takes
 * this share of the sun's light.
 */
const CLOUD_SHADOW_METERS = 1400;
const CLOUD_WIND = Object.freeze({ x: 6, z: 2.5 });
const CLOUD_SHADOW_SHARE = 0.4;
const CLOUD_SHADOW_DARKNESS = 0.65;

type LitMaterial = MeshLambertMaterial | MeshPhongMaterial | MeshStandardMaterial;

/** Where a cloud shades the land at world (x, z) `ground`: 0 in the sun, 1 in the shadow, soft-edged. */
const CLOUD_SHADE = /* glsl */ `
  uniform sampler2D cloudMap;
  uniform vec2 cloudOffset;
  uniform float cloudShare;
  uniform float cloudDarkness;
  uniform float cloudGroundDarkness;
  float cloudShade( vec2 ground ) {
    float cloud = texture2D( cloudMap, ( ground - cloudOffset ) / ${CLOUD_SHADOW_METERS.toFixed(1)} ).r;
    // The more cloud, the lower the edge: more of the land in shadow.
    float edge = 0.62 - 0.3 * cloudShare;
    return smoothstep( edge - 0.03, edge + 0.03, cloud );
  }
`;

/**
 * The shadows of broken cloud drifting over the land with the wind
 * (roadmap: graphics). Pre-lit surfaces (the ground, roads, fields: their
 * light is baked into their colour) lose the sun's share of it; lit ones
 * (trees, buildings, the truck and the traffic) their direct sunlight, so a
 * cloud's shadow darkens all it passes over alike. Clear skies have few,
 * a sky all cloud none (its light is dim all over already). One small
 * texture read per pixel; the uniforms are shared, so setClouds() and
 * drift() cost nothing per material.
 */
export class CloudShadows {
  readonly uniforms = {
    cloudMap: { value: toTexture(cloudShadowImage(), { repeat: true, srgb: false }) },
    /** Where the wind has taken them (meters). */
    cloudOffset: { value: new Vector2() },
    /** How much of the land they shade (0..1). */
    cloudShare: { value: 0 },
    /** How much of the sun's light a shadow takes (0..1)… */
    cloudDarkness: { value: 0 },
    /** …and of a pre-lit surface's whole light: that times the sun's share of it. */
    cloudGroundDarkness: { value: 0 },
  };
  private readonly shaded = new WeakSet<Material>();

  /**
   * Clouds cover `cover` of the sky (0..1) and hide a sun that gives
   * `sunShare` of the ground's light (0..1; little at dusk and at night).
   * Cheap.
   */
  setClouds(cover: number, sunShare: number): void {
    const darkness = CLOUD_SHADOW_DARKNESS * (1 - smoothstep(0.85, 1, cover)) * smoothstep(0, 0.3, sunShare);
    this.uniforms.cloudShare.value = CLOUD_SHADOW_SHARE * cover;
    this.uniforms.cloudDarkness.value = darkness;
    this.uniforms.cloudGroundDarkness.value = darkness * sunShare;
  }

  /** The wind drifts the shadows `deltaSeconds` on. Allocation-free. */
  drift(deltaSeconds: number): void {
    const offset = this.uniforms.cloudOffset.value;
    offset.set((offset.x + CLOUD_WIND.x * deltaSeconds) % CLOUD_SHADOW_METERS, (offset.y + CLOUD_WIND.z * deltaSeconds) % CLOUD_SHADOW_METERS);
  }

  /**
   * The shadows fall on everything under `root` from now on: `prelit`'s
   * materials as pre-lit ground, lit ones (Lambert, Phong, standard) on
   * their sunlight. Leaves out the sky's backdrop (unlitByLamps: it moves
   * with the camera). Once per material, chained after what it does to its
   * shaders already: at boot, when the views have set theirs, and for views
   * built later (the truck); not per frame.
   */
  shadeScene(root: Object3D, prelit: PrelitMaterials): void {
    if (isUnlitByLamps(root)) {
      return;
    }
    if (root instanceof Mesh) {
      for (const material of [root.material as Material | Material[]].flat()) {
        this.shade(material, prelit);
      }
    }
    for (const child of root.children) {
      this.shadeScene(child, prelit);
    }
  }

  dispose(): void {
    this.uniforms.cloudMap.value.dispose();
  }

  private shade(material: Material, prelit: PrelitMaterials): void {
    if (this.shaded.has(material) || isUnlitByLamps(material)) {
      return;
    }
    if (material instanceof MeshBasicMaterial) {
      if (prelit.has(material)) {
        this.shaded.add(material);
        this.shadePrelit(material);
      }
      return;
    }
    if (material instanceof MeshLambertMaterial || material instanceof MeshPhongMaterial || material instanceof MeshStandardMaterial) {
      this.shaded.add(material);
      this.shadeLit(material);
    }
  }

  /** A pre-lit surface: its baked light, before anything adds more (the lamps), loses the sun's share under a cloud. */
  private shadePrelit(material: MeshBasicMaterial): void {
    chain(material, 'clouds-prelit', (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vCloudGround;').replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 cloudGround = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          cloudGround = instanceMatrix * cloudGround;
        #endif
        vCloudGround = ( modelMatrix * cloudGround ).xz;`,
      );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec2 vCloudGround;\n${CLOUD_SHADE}`)
        .replace(
          '#include <envmap_fragment>',
          'outgoingLight *= 1.0 - cloudGroundDarkness * cloudShade( vCloudGround );\n#include <envmap_fragment>',
        );
    });
  }

  /**
   * A lit surface: its direct light (the sun's) dims under a cloud, where
   * the fragment is in the world (from the camera and its view position:
   * no vertex changes, so views that move their vertices keep theirs).
   */
  private shadeLit(material: LitMaterial): void {
    chain(material, 'clouds-lit', (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${CLOUD_SHADE}`).replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          vec3 cloudWorld = cameraPosition - ( vec4( vViewPosition, 0.0 ) * viewMatrix ).xyz;
          float cloudLight = 1.0 - cloudDarkness * cloudShade( cloudWorld.xz );
          reflectedLight.directDiffuse *= cloudLight;
          reflectedLight.directSpecular *= cloudLight;
        }`,
      );
    });
  }
}

/** Runs `inject` after whatever `material` did to its shaders already, and keeps its program apart. */
function chain(material: Material, variant: string, inject: (shader: Parameters<Material['onBeforeCompile']>[0]) => void): void {
  const previous = material.onBeforeCompile.bind(material);
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    inject(shader);
  };
  material.customProgramCacheKey = () => `${key}|${variant}`;
}
