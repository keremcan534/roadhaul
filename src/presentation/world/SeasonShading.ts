import {
  Color,
  Mesh,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  Vector3,
  Vector4,
  type Camera,
  type Material,
  type Object3D,
} from 'three';
import { SEASONS, type Season } from '../../data/definitions/Season';
import { isUnlitByLamps } from './LampLighting';

/**
 * How each season looks on the land: how dry the grass has grown (toward
 * straw, 0..1), its tint after that (multiplying its colour), how far the
 * broadleaf trees have turned (autumn's colours), how bare they stand
 * (winter), how many blossom (spring), and how many of the verges' flowers
 * are out.
 */
const LOOKS: Readonly<
  Record<
    Season,
    {
      readonly dry: number;
      readonly grass: readonly [number, number, number];
      readonly autumn: number;
      readonly bare: number;
      readonly blossom: number;
      readonly flowers: number;
    }
  >
> = {
  spring: { dry: 0, grass: [0.92, 1.08, 0.86], autumn: 0, bare: 0, blossom: 1, flowers: 1 },
  summer: { dry: 0.12, grass: [1.02, 1, 0.9], autumn: 0, bare: 0, blossom: 0, flowers: 0.75 },
  autumn: { dry: 0.6, grass: [1.05, 0.95, 0.8], autumn: 1, bare: 0, blossom: 0, flowers: 0.15 },
  winter: { dry: 0.7, grass: [0.95, 0.95, 0.92], autumn: 0.25, bare: 1, blossom: 0, flowers: 0 },
};
/** The land turns to a new season's look over this long, seconds: a season picked in Settings is not a cut. */
const TURN_SECONDS = 2.5;

type LitMaterial = MeshLambertMaterial | MeshPhongMaterial | MeshStandardMaterial;

/** What views set on what the snow should leave alone (people, birds). */
const NO_SNOW = 'noSnow';

/** Keeps the snow off `object` and everything under it, or off a material. */
export function keptFromSnow(object: Object3D | Material): void {
  object.userData[NO_SNOW] = true;
}

/**
 * The seasons' uniforms, for the shaders that follow them (the ground, the
 * trees, the verges' plants, the fields, the hills): the season's weights
 * (spring, summer, autumn, winter; they add to 1, and blend while the land
 * turns), how dry the grass is and its tint, the broadleaf trees' state
 * (x autumn, y bare, z blossom), the flowers out (0..1), how much snow
 * lies (0..1) and the way up as the camera sees it (for what faces up: snow
 * settles there). SNOW is the colour of fresh snow in the light; dried()
 * turns a green toward straw of the same lightness, as far as the season
 * has dried the grass.
 */
export const SEASON_GLSL = /* glsl */ `
uniform vec4 seasonWeights;
uniform vec3 seasonGrass;
uniform float seasonDry;
uniform vec3 seasonLeaves;
uniform float seasonFlowers;
uniform float snowCover;
uniform vec3 snowUp;
const vec3 SNOW = vec3( 0.92, 0.94, 0.97 );
vec3 dried( vec3 green ) {
  float lightness = dot( green, vec3( 0.2126, 0.7152, 0.0722 ) );
  return mix( green, vec3( 1.2, 1.0, 0.5 ) * lightness, seasonDry );
}
`;

/**
 * After three's normal chunks, in a lit material's fragment shader: snow
 * whitens what faces up (roofs, the tops of crowns and posts, pavements),
 * as much as lies.
 */
const SNOW_ON_TOP = /* glsl */ `
if ( snowCover > 0.0 ) {
  float snowFacing = dot( normal, snowUp );
  diffuseColor.rgb = mix( diffuseColor.rgb, SNOW, snowCover * smoothstep( 0.2, 0.7, snowFacing ) );
}
`;

/**
 * The seasons on the land (roadmap: seasons): the grass greener in spring,
 * drier in summer, faded in autumn; the broadleaf trees in blossom, in
 * leaf, turned and bare; the verges' flowers out in spring and summer; and
 * snow lying as the weather says (WeatherService.snowCover): on the ground,
 * the hills and whatever faces up. Uniforms shared by every material that
 * follows them (attach, SEASON_GLSL): update() costs nothing per material.
 */
export class SeasonShading {
  readonly uniforms = {
    seasonWeights: { value: new Vector4(0, 1, 0, 0) },
    seasonGrass: { value: new Color(1, 1, 1) },
    seasonDry: { value: 0 },
    seasonLeaves: { value: new Vector3() },
    seasonFlowers: { value: 1 },
    snowCover: { value: 0 },
    snowUp: { value: new Vector3(0, 1, 0) },
  };
  /** Each season's share of the look now, in SEASONS' order. */
  private readonly weights = [0, 1, 0, 0];
  private readonly shaded = new WeakSet<Material>();
  private target: Season = 'summer';

  constructor(season: Season = 'summer') {
    this.setSeason(season, true);
  }

  /** The season the land turns to: over a moment, or at once. */
  setSeason(season: Season, immediately = false): void {
    this.target = season;
    if (immediately) {
      for (let i = 0; i < SEASONS.length; i++) {
        this.weights[i] = SEASONS[i] === season ? 1 : 0;
      }
      this.apply();
    }
  }

  /** The season the land shows most of now. */
  get shown(): Season {
    let most = 0;
    for (let i = 1; i < SEASONS.length; i++) {
      if (this.weights[i]! > this.weights[most]!) {
        most = i;
      }
    }
    return SEASONS[most]!;
  }

  /**
   * The land turns `deltaSeconds` on toward the season set; `snowCover`
   * (0..1) lies; `camera` sees the way up. Every frame, after the camera
   * has moved. Allocation-free.
   */
  update(deltaSeconds: number, snowCover: number, camera: Camera): void {
    const step = deltaSeconds / TURN_SECONDS;
    let moved = false;
    for (let i = 0; i < SEASONS.length; i++) {
      const goal = SEASONS[i] === this.target ? 1 : 0;
      const weight = this.weights[i]!;
      if (weight !== goal) {
        this.weights[i] = goal > weight ? Math.min(goal, weight + step) : Math.max(goal, weight - step);
        moved = true;
      }
    }
    if (moved) {
      this.apply();
    }
    this.uniforms.snowCover.value = Math.min(1, Math.max(0, snowCover));
    camera.updateMatrixWorld();
    this.uniforms.snowUp.value.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
  }

  /** Gives `shader` the seasons' uniforms (its code declares them with SEASON_GLSL). */
  attach(shader: { uniforms: Record<string, unknown> }): void {
    Object.assign(shader.uniforms, this.uniforms);
  }

  /**
   * Snow settles on what faces up under `root` from now on: the lit
   * materials (Lambert, Phong, standard), chained after what they do to
   * their shaders already. Leaves out what keptFromSnow() or unlitByLamps()
   * (the sky's backdrop) marked. Once per material: at boot, and for views
   * built later (the truck); not per frame.
   */
  shadeScene(root: Object3D): void {
    if (root.userData[NO_SNOW] === true || isUnlitByLamps(root)) {
      return;
    }
    if (root instanceof Mesh) {
      for (const material of [root.material as Material | Material[]].flat()) {
        this.shade(material);
      }
    }
    for (const child of root.children) {
      this.shadeScene(child);
    }
  }

  private shade(material: Material): void {
    if (this.shaded.has(material) || material.userData[NO_SNOW] === true || isUnlitByLamps(material)) {
      return;
    }
    if (!(material instanceof MeshLambertMaterial || material instanceof MeshPhongMaterial || material instanceof MeshStandardMaterial)) {
      return;
    }
    this.shaded.add(material);
    this.snowOnTop(material);
  }

  private snowOnTop(material: LitMaterial): void {
    const previous = material.onBeforeCompile.bind(material);
    const key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      previous(shader, renderer);
      this.attach(shader);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${SEASON_GLSL}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${SNOW_ON_TOP}`);
    };
    material.customProgramCacheKey = () => `${key}|snow`;
  }

  /** The uniforms for the weights now: the season's look, blended. */
  private apply(): void {
    const u = this.uniforms;
    const [spring, summer, autumn, winter] = this.weights as [number, number, number, number];
    u.seasonWeights.value.set(spring, summer, autumn, winter);
    let dry = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    let turned = 0;
    let bare = 0;
    let blossom = 0;
    let flowers = 0;
    for (let i = 0; i < SEASONS.length; i++) {
      const look = LOOKS[SEASONS[i]!];
      const weight = this.weights[i]!;
      dry += look.dry * weight;
      r += look.grass[0] * weight;
      g += look.grass[1] * weight;
      b += look.grass[2] * weight;
      turned += look.autumn * weight;
      bare += look.bare * weight;
      blossom += look.blossom * weight;
      flowers += look.flowers * weight;
    }
    u.seasonDry.value = dry;
    u.seasonGrass.value.setRGB(r, g, b);
    u.seasonLeaves.value.set(turned, bare, blossom);
    u.seasonFlowers.value = flowers;
  }
}
