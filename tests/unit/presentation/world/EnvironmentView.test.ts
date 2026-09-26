import {
  BufferGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Scene,
  ShaderLib,
  ShaderMaterial,
  ShadowMaterial,
  Vector3,
  Vector4,
} from 'three';
import { describe, expect, it } from 'vitest';
import { smoothstep } from '../../../../src/core/math/scalar';
import { DAYLIGHT } from '../../../../src/data/content/daylight';
import { WEATHER } from '../../../../src/data/content/weather';
import type { WeatherLook } from '../../../../src/data/definitions/WeatherDefinition';
import { composeSky, createSkyLook, daylightWeights, mixWeather, type SkyLook } from '../../../../src/domain/sky/skyLook';
import type { SkyDirection } from '../../../../src/domain/sky/solar';
import {
  CLOUD_COUNT,
  EnvironmentView,
  PUFFS_PER_CLOUD,
  type SkyPlacement,
} from '../../../../src/presentation/world/EnvironmentView';
import { PrelitMaterials, SKY_LIGHT_INTENSITY, SUN_DIRECTION, SUN_INTENSITY } from '../../../../src/presentation/world/lighting';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

function look(weatherId: string): WeatherLook {
  return WEATHER.find((weather) => weather.id === weatherId)!.look;
}

/** `elevation` degrees up toward `bearing` degrees (0 north, 90 east), in the world's axes: x east, y up, z south. */
function toward(elevation: number, bearing: number): SkyDirection {
  const up = (elevation * Math.PI) / 180;
  const round = (bearing * Math.PI) / 180;
  return { x: Math.cos(up) * Math.sin(round), y: Math.sin(up), z: -Math.cos(up) * Math.cos(round) };
}

const DAY_SUN: SkyDirection = { ...SUN_DIRECTION };
const MOON_UP = toward(30, 120);

/** The sky with the sun `elevation` degrees up (setting, unless `rising`) in the `weatherId` weather, the moon full and up. */
function skyAt(elevation: number, weatherId = 'clear', rising = false): SkyLook {
  const daylight = (id: string) => DAYLIGHT.find((candidate) => candidate.id === id)!;
  const twilight = daylight(rising ? 'dawn' : 'dusk');
  const night = daylight('night');
  const weather = mixWeather(look(weatherId), look(weatherId), 1, createSkyLook());
  const weights = daylightWeights(elevation, 12, twilight.sunElevationDegrees, night.sunElevationDegrees, {
    day: 0,
    twilight: 0,
    night: 0,
  });
  return composeSky(look('clear'), twilight.look, night.look, weights, smoothstep(-1, 3, elevation), 1, weather, createSkyLook());
}

/** The sun at `sun`, the moon at `moon` and `moonPhase`, the stars turned `starTurn`. */
function placed(sun: SkyDirection, moon: SkyDirection = MOON_UP, moonPhase = 0.5, starTurn = 0): SkyPlacement {
  return { sun, moon, moonPhase, starTurn };
}

/** The stars (the mesh drawn first of the see-through ones) and the moon (the textured one after them). */
function nightSky(scene: Scene): { stars: Mesh; moon: Mesh } {
  let stars: Mesh | undefined;
  let moon: Mesh | undefined;
  scene.traverse((object) => {
    if (object instanceof Mesh && object.renderOrder === -3) stars = object;
    if (object instanceof Mesh && object.renderOrder === -2) moon = object;
  });
  return { stars: stars!, moon: moon! };
}

function clouds(scene: Scene): Mesh {
  return scene.getObjectByName('clouds') as Mesh;
}

/** The day, halfway from one weather to another. */
function composeHalfway(from: string, to: string): SkyLook {
  const weather = mixWeather(look(from), look(to), 0.5, createSkyLook());
  const dusk = DAYLIGHT.find((daylight) => daylight.id === 'dusk')!;
  const night = DAYLIGHT.find((daylight) => daylight.id === 'night')!;
  return composeSky(look('clear'), dusk.look, night.look, { day: 1, twilight: 0, night: 0 }, 1, 1, weather, createSkyLook());
}

function dome(scene: Scene): ShaderMaterial {
  let material: ShaderMaterial | undefined;
  scene.traverse((object) => {
    // The sky's dome: the sun's uniforms, and no picture (the clouds share the uniforms and have one).
    if (object instanceof Mesh && object.material instanceof ShaderMaterial && 'sunLow' in object.material.uniforms && !('map' in object.material.uniforms)) {
      material = object.material;
    }
  });
  return material!;
}

describe('EnvironmentView', () => {
  it('lights the scene from the sun and the sky, with haze in the distance', () => {
    const scene = new Scene();
    new EnvironmentView(scene);

    const sun = scene.children.find((child) => child instanceof DirectionalLight);
    expect(sun).toBeDefined();
    expect(sun!.position.clone().normalize().toArray().map((value) => value.toFixed(6))).toEqual(
      [SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z].map((value) => value.toFixed(6)),
    );
    expect(scene.children.some((child) => child instanceof HemisphereLight)).toBe(true);
    expect(scene.fog).toBeInstanceOf(FogExp2);
    // The dome, the hills and the clouds; the stars and the moon at night.
    expect(drawCallCount(scene)).toBeLessThanOrEqual(5);
  });

  it('keeps the sky, clouds, hills, stars and moon centred on the camera', () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene);
    const backdrop = scene.children.find((child) => child.children.length === 5)!;

    view.update({ x: 120, z: -340 });

    expect(backdrop.position.toArray()).toEqual([120, 0, -340]);
  });

  it('puts out the stars and the moon at night, the moon where it stands and lighting the night, and hides them by day', () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene);
    const light = scene.children.find((child) => child instanceof DirectionalLight)!;
    const { stars, moon } = nightSky(scene);

    view.applySky(skyAt(48), placed(DAY_SUN));
    expect(stars.visible).toBe(false);
    expect(moon.visible).toBe(false);

    view.applySky(skyAt(-25), placed(toward(-25, 330)));
    expect(stars.visible).toBe(true);
    expect((stars.material as ShaderMaterial).uniforms['level']!.value).toBe(1);
    expect(moon.visible).toBe(true);
    expect((moon.material as MeshBasicMaterial).opacity).toBe(1);
    const toMoon = new Vector3(MOON_UP.x, MOON_UP.y, MOON_UP.z);
    expect(moon.position.clone().normalize().distanceTo(toMoon)).toBeLessThan(1e-9);
    // The night's key light is the moon's, and it faces the camera at the centre.
    expect(light.position.clone().sub(light.target.position).normalize().distanceTo(toMoon)).toBeLessThan(1e-9);
    expect(new Vector3(0, 0, 1).applyQuaternion(moon.quaternion).dot(toMoon)).toBeCloseTo(-1, 9);

    // With the moon down, the night's faint light comes from high up, and the moon hides.
    view.applySky(skyAt(-25), placed(toward(-25, 330), toward(-10, 60)));
    expect(moon.visible).toBe(false);
    expect(light.position.clone().sub(light.target.position).normalize().y).toBeGreaterThan(0.8);

    // The first stars come out at dusk, without the moon.
    view.applySky(skyAt(3), placed(toward(3, 245)));
    expect(stars.visible).toBe(true);
    expect((stars.material as ShaderMaterial).uniforms['level']!.value).toBeLessThan(0.3);
    expect(moon.visible).toBe(false);
  });

  it('lights the moon on its side toward the sun: full opposite it, dark beside it', () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene);
    const { moon } = nightSky(scene);
    const material = moon.material as MeshBasicMaterial;
    const shader = {
      uniforms: {} as Record<string, { value: Vector3 }>,
      vertexShader: '',
      fragmentShader: '#include <common>\n#include <map_fragment>',
    };
    material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.fragmentShader).toContain('dot(ball, moonLit)');
    const lit = shader.uniforms['moonLit']!.value;

    // Full: the sun behind the camera, opposite the moon; the lit side faces the camera.
    const full = MOON_UP;
    view.applySky(skyAt(-25), placed({ x: -full.x, y: -full.y, z: -full.z }, full, 0.5));
    expect(lit.z).toBeCloseTo(1, 6);
    // New: the sun beside the moon, behind it; the side toward the camera is dark.
    view.applySky(skyAt(-25), placed(toward(-25, 120), toward(-24, 120), 0));
    expect(lit.z).toBeLessThan(-0.9);
  });

  it('turns the stars round the sky\'s pole, high over the north by the latitude', () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene, { latitudeDegrees: 39 });
    const { stars } = nightSky(scene);
    const pole = new Vector3(0, Math.sin((39 * Math.PI) / 180), -Math.cos((39 * Math.PI) / 180));

    view.applySky(skyAt(-25), placed(toward(-25, 330), MOON_UP, 0.5, 1.2));

    expect(pole.clone().applyQuaternion(stars.quaternion).distanceTo(pole)).toBeLessThan(1e-9);
    const zenith = new Vector3(0, 1, 0);
    expect(zenith.clone().applyQuaternion(stars.quaternion).distanceTo(zenith)).toBeGreaterThan(0.1);
  });

  it('twinkles the stars as time goes by, and not while it stands still', () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene);
    const time = (nightSky(scene).stars.material as ShaderMaterial).uniforms['time']!;

    view.update({ x: 0, z: 0 }, 0.5);
    view.update({ x: 0, z: 0 }, 0.25);
    expect(time.value).toBeCloseTo(0.75, 9);
    view.update({ x: 0, z: 0 });
    expect(time.value).toBeCloseTo(0.75, 9);
  });

  it('turns sky, haze, light, clouds and the pre-lit ground to the time of day and the weather', () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene);
    const prelit = new PrelitMaterials();
    const ground = prelit.add(new MeshBasicMaterial({ color: 0xffffff }));
    const fog = scene.fog as FogExp2;
    const light = scene.children.find((child) => child instanceof DirectionalLight)!;
    const sky = scene.children.find((child) => child instanceof HemisphereLight)!;
    const background = scene.background as Color;

    // The clear day the looks were drawn for: the sun as high as SUN_DIRECTION.
    view.applySky(skyAt(48), placed(DAY_SUN), prelit);
    const day = { light: light.intensity, sky: sky.intensity, background: background.clone(), clouds: view.cloudCount };
    expect(fog.density).toBeCloseTo(look('clear').fogDensity, 12);
    expect(light.intensity).toBeCloseTo(SUN_INTENSITY, 9);
    expect(sky.intensity).toBeCloseTo(SKY_LIGHT_INTENSITY, 9);
    expect(ground.color.r).toBeCloseTo(1, 2);

    const night = skyAt(-25);
    view.applySky(night, placed(toward(-25, 330)), prelit);
    expect(fog.density).toBeCloseTo(night.fogDensity, 12);
    expect(light.intensity).toBeCloseTo(SUN_INTENSITY * night.moonlight, 9);
    expect(sky.intensity).toBeCloseTo(SKY_LIGHT_INTENSITY * night.skylight, 9);
    expect(background.r + background.g + background.b).toBeLessThan((day.background.r + day.background.g + day.background.b) / 4);
    expect(view.cloudCount).toBeLessThan(day.clouds);
    expect(ground.color.g).toBeLessThan(0.4);

    // Halfway from clear to rain by day: the haze and the clouds halfway between the two.
    const halfway = composeHalfway('clear', 'rain');
    view.applySky(halfway, placed(DAY_SUN), prelit);
    expect(fog.density).toBeCloseTo((look('clear').fogDensity + look('rain').fogDensity) / 2, 6);
    expect(view.cloudCount).toBe(Math.round((CLOUD_COUNT * (look('clear').cloudCover + look('rain').cloudCover)) / 2));
    // Every puff of every cloud shown, in one draw call.
    const puffs = clouds(scene).geometry as InstancedBufferGeometry;
    expect(puffs.instanceCount).toBe(view.cloudCount * PUFFS_PER_CLOUD);
    expect(clouds(scene).visible).toBe(true);
  });

  it('tells shaders that light themselves the lights\' colours and strengths as they shade the scene now', () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene);
    const light = view.light;
    const sun = scene.children.find((child) => child instanceof DirectionalLight)!;
    const sky = scene.children.find((child) => child instanceof HemisphereLight)!;

    view.applySky(skyAt(48), placed(DAY_SUN));
    expect(light.key.r).toBeCloseTo(sun.color.r * sun.intensity, 9);
    expect(light.sky.g).toBeCloseTo(sky.color.g * sky.intensity, 9);
    expect(light.ground.b).toBeCloseTo(sky.groundColor.b * sky.intensity, 9);
    expect(light.keyDirection.y).toBeGreaterThan(0.5);
    const day = light.sky.g;

    view.applySky(skyAt(-25), placed(toward(-25, 330)));
    expect(light.sky.g).toBeLessThan(day / 2);
    expect(light.key.r).toBeCloseTo(sun.color.r * sun.intensity, 9);
    // The same object, kept up to date.
    expect(view.light).toBe(light);
  });

  it('exposes a low winter sun a little brighter, as the eye adapts, but not a setting one', () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene);
    const sky = scene.children.find((child) => child instanceof HemisphereLight)!;

    const winter = skyAt(22);
    view.applySky(winter, placed(toward(22, 190)));
    expect(sky.intensity).toBeGreaterThan(SKY_LIGHT_INTENSITY * winter.skylight * 1.15);
    expect(sky.intensity).toBeLessThanOrEqual(SKY_LIGHT_INTENSITY * winter.skylight * 1.3 + 1e-9);

    const dusk = skyAt(3);
    view.applySky(dusk, placed(toward(3, 245)));
    expect(sky.intensity).toBeCloseTo(SKY_LIGHT_INTENSITY * dusk.skylight, 9);
  });

  it('builds soft clouds of puffs that drift round the camera, lit by the sky, and none in a clear night sky', () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene);
    const cloud = clouds(scene);
    const material = cloud.material as ShaderMaterial;
    const drift = material.uniforms['drift']!;
    // The sky's own uniforms light them, so they follow the weather.
    expect(material.uniforms['sunColor']).toBe(view.sky.sunColor);
    expect(material.uniforms['horizon']).toBe(view.sky.horizon);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    // Over the stars and the moon, under everything else see-through.
    const { stars, moon } = nightSky(scene);
    expect(cloud.renderOrder).toBeGreaterThan(moon.renderOrder);
    expect(moon.renderOrder).toBeGreaterThan(stars.renderOrder);
    expect(cloud.renderOrder).toBeLessThan(0);

    view.update({ x: 0, z: 0 }, 60);
    expect(drift.value).toBeGreaterThan(0.1);
    expect(drift.value).toBeLessThan(0.2);
    const turned = drift.value;
    view.update({ x: 0, z: 0 });
    expect(drift.value).toBe(turned);

    view.applySky({ ...skyAt(-25), cloudCover: 0 }, placed(toward(-25, 330)));
    expect(view.cloudCount).toBe(0);
    expect(cloud.visible).toBe(false);
  });

  it('shows only its share of the weather\'s clouds when asked for fewer', () => {
    const rain = skyAt(48, 'rain');
    const full = new EnvironmentView(new Scene());
    const half = new EnvironmentView(new Scene(), { cloudShare: 0.5 });
    full.applySky(rain, placed(DAY_SUN));
    half.applySky(rain, placed(DAY_SUN));

    expect(full.cloudCount).toBe(Math.round(CLOUD_COUNT * rain.cloudCover));
    expect(half.cloudCount).toBe(Math.round(CLOUD_COUNT * rain.cloudCover * 0.5));
    expect(half.cloudCount).toBeGreaterThan(0);
  });

  it('rings the horizon with two ridges of smooth hills that take the weather\'s haze', () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene);
    const hills = scene.getObjectByName('hills') as Mesh;
    const geometry = hills.geometry as BufferGeometry;
    const position = geometry.getAttribute('position');
    const haze = geometry.getAttribute('haze');
    const radii = new Set<number>();
    let highest = 0;
    for (let i = 0; i < position.count; i++) {
      radii.add(Math.round(Math.hypot(position.getX(i), position.getZ(i)) / 50));
      highest = Math.max(highest, position.getY(i));
      expect(haze.getX(i)).toBeGreaterThanOrEqual(0);
      expect(haze.getX(i)).toBeLessThanOrEqual(1);
    }
    // Two ridges, one behind the other, within the sky dome; mountains over 100 m high.
    expect(Math.min(...radii) * 50).toBeGreaterThan(550);
    expect(Math.max(...radii) * 50).toBeLessThan(800);
    expect(highest).toBeGreaterThan(100);
    // Smooth-shaded, and hazed with the sky's horizon colour.
    const material = hills.material as MeshLambertMaterial;
    expect(material.flatShading).toBe(false);
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <opaque_fragment>' };
    material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.uniforms['hazeColor']).toBe(view.sky.horizon);
    expect(shader.fragmentShader).toContain('mix(gl_FragColor.rgb, hazeColor, vHaze) + vTownGlow');
  });

  it('lowers the sun at dusk: warm, low light, a glowing horizon, less of it on flat ground, and a glow after sunset', () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene);
    const prelit = new PrelitMaterials();
    const ground = prelit.add(new MeshBasicMaterial({ color: 0xffffff }));
    const light = scene.children.find((child) => child instanceof DirectionalLight)!;
    const uniforms = dome(scene).uniforms;

    view.applySky(skyAt(48), placed(DAY_SUN), prelit);
    const noonGround = ground.color.clone();
    expect(uniforms['sunLow']!.value).toBeLessThan(1e-6);
    expect(light.position.clone().normalize().y).toBeCloseTo(SUN_DIRECTION.y, 6);

    const setting = toward(3, 245);
    view.applySky(skyAt(3), placed(setting), prelit);
    const low = light.position.clone().sub(light.target.position).normalize();
    // A few degrees over the horizon, where the sun stands.
    expect(low.distanceTo(new Vector3(setting.x, setting.y, setting.z))).toBeLessThan(1e-6);
    const skySun = uniforms['sunDirection']!.value as Vector3;
    expect(skySun.distanceTo(low)).toBeLessThan(1e-6);
    expect(uniforms['sunLow']!.value).toBeGreaterThan(0.7);
    // The glow is the evening light's colour: more red than blue.
    const glow = uniforms['sunColor']!.value as Color;
    expect(glow.r).toBeGreaterThan(glow.b * 2);
    expect(ground.color.g).toBeLessThan(noonGround.g * 0.8);

    // Set: its light gone from the ground, the sky still glowing where it went down; its disc hidden below.
    const set = toward(-3, 250);
    view.applySky(skyAt(-3), placed(set), prelit);
    expect(light.intensity).toBeLessThanOrEqual(SUN_INTENSITY * 0.1 + 1e-9);
    expect((uniforms['sunDirection']!.value as Vector3).distanceTo(new Vector3(set.x, set.y, set.z))).toBeLessThan(1e-6);
    expect((uniforms['sunColor']!.value as Color).r).toBeGreaterThan(0.05);
    expect(dome(scene).fragmentShader).toContain('smoothstep(-0.01, 0.01, sunDirection.y)');
  });

  it("colours the sky opposite a setting sun: the Earth's shadow rising on the horizon, the Belt of Venus over it", () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene);
    const uniforms = dome(scene).uniforms;
    const twilightAt = (elevation: number, weather = 'clear'): number => {
      view.applySky(skyAt(elevation, weather), placed(toward(elevation, 250)));
      return uniforms['twilight']!.value as number;
    };

    expect(twilightAt(40)).toBe(0);
    expect(twilightAt(2)).toBeGreaterThan(0.1);
    expect(twilightAt(-2)).toBeGreaterThan(0.4);
    expect(twilightAt(-10)).toBe(0);
    // Clouds and rain hide it.
    expect(twilightAt(-2, 'rain')).toBe(0);
    expect(twilightAt(-2, 'cloudy')).toBeLessThan(twilightAt(-2) / 3);
    // Away from the sun, flat; the shadow's top higher the lower the sun.
    view.applySky(skyAt(-1), placed(toward(-1, 250)));
    const away = uniforms['twilightAway']!.value as { x: number; y: number };
    const sun = toward(-1, 250);
    expect(away.x * sun.x + away.y * sun.z).toBeLessThan(-0.99);
    const shallow = uniforms['earthShadow']!.value as number;
    view.applySky(skyAt(-5), placed(toward(-5, 250)));
    expect(uniforms['earthShadow']!.value).toBeGreaterThan(shallow);
    expect(dome(scene).fragmentShader).toContain('earthShadow');
  });

  it('shows a rainbow opposite a low sun in the rain passing by or just gone, not in the rain, the dry, the dark or a high sun', () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene);
    const rainbow = dome(scene).uniforms['rainbow']!;
    const rainbowAt = (elevation: number, weather: string, wetness: number): number => {
      view.setWetness(wetness);
      view.applySky(skyAt(elevation, weather), placed(toward(elevation, 250)));
      return rainbow.value as number;
    };

    // Just after the rain, the ground still wet and the sun out low: a bright bow, fading as the ground dries.
    expect(rainbowAt(12, 'clear', 0.9)).toBeGreaterThan(0.9);
    expect(rainbowAt(12, 'clear', 0.2)).toBeLessThan(rainbowAt(12, 'clear', 0.9));
    expect(rainbowAt(12, 'clear', 0)).toBe(0);
    // In the rain itself the drops are all round and the sun hidden; under cloud too little sun gets through.
    expect(rainbowAt(12, 'rain', 1)).toBe(0);
    expect(rainbowAt(12, 'cloudy', 0.9)).toBeLessThan(0.5);
    // Too high a sun sets the bow below the hills; none once it has set.
    expect(rainbowAt(45, 'clear', 0.9)).toBe(0);
    expect(rainbowAt(-2, 'clear', 0.9)).toBe(0);
    // Showers: halfway from the rain to the sun, still falling.
    view.setWetness(1);
    view.applySky(composeHalfway('rain', 'clear'), placed(toward(12, 250)));
    expect(rainbow.value).toBeGreaterThan(0.5);
    expect(dome(scene).fragmentShader).toContain('rainbowOver(sky, direction, up, sunDirection, sunColor, rainbow)');
  });

  it('glows over the towns at night on the horizon toward each: all round in one, smaller and dimmer the farther', () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene);
    const glow = dome(scene).uniforms['townGlow']!.value as Vector4[];
    view.setTowns([
      { x: 0, z: 0 },
      { x: 3000, z: 0 },
    ]);

    // Not by day, even with the lamps lit under rain clouds.
    view.applySky(skyAt(40), placed(toward(40, 180)));
    view.update({ x: -2000, z: 0 });
    expect(glow.every((town) => town.z === 0)).toBe(true);
    view.applySky(skyAt(40, 'rain'), placed(toward(40, 180)));
    view.update({ x: -2000, z: 0 });
    expect(glow.every((town) => town.z === 0)).toBe(true);

    view.applySky(skyAt(-20), placed(toward(-20, 250)));
    view.update({ x: -2000, z: 0 });
    const [near, farther] = glow.map((town) => town.clone());
    // Both east of the camera: the way toward them along +x; the nearer a little brighter (less air between)
    // and standing taller (its glow fading slower up the sky); the unused slots dark.
    expect(near!.x).toBeCloseTo(1, 6);
    expect(near!.y).toBeCloseTo(0, 6);
    expect(near!.z).toBeGreaterThan(farther!.z);
    expect(near!.w).toBeLessThan(farther!.w / 2);
    expect(glow[2]!.z).toBe(0);
    // In the town: all round, and at its brightest.
    view.update({ x: 50, z: 0 });
    expect(Math.hypot(glow[0]!.x, glow[0]!.y)).toBeLessThan(0.1);
    expect(glow[0]!.z).toBeGreaterThan(near!.z);
    // On the sky, the hills' haze and the clouds' undersides alike.
    expect(dome(scene).fragmentShader).toContain('townsGlow(bearing, height)');
    const cloudMaterial = clouds(scene).material as ShaderMaterial;
    expect(cloudMaterial.uniforms['townGlow']).toBe(dome(scene).uniforms['townGlow']);
    expect(cloudMaterial.vertexShader).toContain('vTownGlow = townsGlow(');
  });

  it('tells the colour pass where the sun is and how it may glare, and the clouds how much light they can shade', () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene);

    view.applySky(skyAt(40), placed(toward(40, 180)));
    const noon = { glare: view.sunGlare, share: view.sunShare };
    const sun = toward(40, 180);
    expect(view.sunTowards.distanceTo(new Vector3(sun.x, sun.y, sun.z))).toBeLessThan(1e-9);
    expect(noon.glare).toBeGreaterThan(0.3);
    expect(noon.share).toBeGreaterThan(0.4);
    expect(noon.share).toBeLessThan(1);

    view.applySky(skyAt(40, 'rain'), placed(toward(40, 180)));
    expect(view.sunGlare).toBe(0);
    // After sunset only the moon lights the ground from one side, faintly.
    view.applySky(skyAt(-6), placed(toward(-6, 250)));
    expect(view.sunGlare).toBe(0);
    expect(view.sunShare).toBeLessThan(noon.share / 2);
  });

  it('grades the picture by the time and the weather: warm at dusk, cool at night, grey in the rain, darker corners under lit lamps', () => {
    const view = new EnvironmentView(new Scene());
    const clear = look('clear');

    view.applySky(skyAt(48), placed(DAY_SUN));
    const day = { ...view.grade };
    expect(day).toMatchObject({ saturation: clear.saturation, contrast: clear.contrast, warmth: clear.warmth, bloom: clear.bloom });

    view.applySky(skyAt(3), placed(toward(3, 245)));
    expect(view.grade.warmth).toBeGreaterThan(day.warmth);
    view.applySky(skyAt(-25), placed(toward(-25, 330)));
    const dark = { ...view.grade };
    expect(dark.warmth).toBeLessThan(day.warmth);
    expect(dark.bloom).toBeGreaterThan(day.bloom);
    expect(dark.vignette).toBeGreaterThan(day.vignette);
    // The exposure is the day's at every time and in every weather.
    expect(dark.exposure).toBe(day.exposure);
    view.applySky(skyAt(48, 'rain'), placed(DAY_SUN));
    expect(view.grade.saturation).toBeLessThan(day.saturation);
  });

  it('thins the haze through the colour pass, where fog mixes in linear light and shows more', () => {
    const screen = new Scene();
    const hdr = new Scene();
    const onScreen = new EnvironmentView(screen);
    const throughPass = new EnvironmentView(hdr, { hdr: true });

    for (const [name, sky] of [
      ['clear', skyAt(48)],
      ['rain', skyAt(48, 'rain')],
      ['night', skyAt(-25)],
    ] as const) {
      onScreen.applySky(sky, placed(DAY_SUN));
      throughPass.applySky(sky, placed(DAY_SUN));
      const [plain, linear] = [(screen.fog as FogExp2).density, (hdr.fog as FogExp2).density];
      expect(linear, name).toBeLessThan(plain);
      expect(linear, name).toBeGreaterThan(plain * 0.5);
    }
  });

  it('casts the sun\'s real-time shadows round the truck when asked: a shadow camera that keeps still between texels', () => {
    const plain = new Scene();
    new EnvironmentView(plain);
    expect(plain.getObjectByName('sun-shadows')).toBeUndefined();
    expect(plain.children.find((child) => child instanceof DirectionalLight)!.castShadow).toBe(false);

    const scene = new Scene();
    const view = new EnvironmentView(scene, { shadowMapSize: 1024 });
    const sun = scene.children.find((child) => child instanceof DirectionalLight)!;
    const ground = scene.getObjectByName('sun-shadows') as Mesh;
    expect(sun.castShadow).toBe(true);
    expect(sun.shadow.mapSize.toArray()).toEqual([1024, 1024]);
    expect(ground.receiveShadow).toBe(true);
    expect(ground.material).toBeInstanceOf(ShadowMaterial);
    // Drawn once whatever the weather: lit shaders sample the map even while it is not updated.
    expect(sun.shadow.needsUpdate).toBe(true);
    // The light's target follows the focus, so it is in the scene.
    expect(sun.target.parent).toBe(scene);

    view.applySky(skyAt(48), placed(DAY_SUN));
    view.focusShadows(1234.5, -678.25);
    expect(ground.position.x).toBe(1234.5);
    expect(ground.position.z).toBe(-678.25);
    // Near the focus (within a texel across the rays), and the light still comes from the sun.
    const texel = 100 / 1024;
    const target = sun.target.position.clone();
    const towardFocus = new Vector3(1234.5, 0, -678.25).sub(target);
    const direction = view.sky.sunDirection.value;
    const across = towardFocus.clone().sub(direction.clone().multiplyScalar(towardFocus.dot(direction)));
    expect(across.length()).toBeLessThan(texel);
    expect(sun.position.clone().sub(target).normalize().distanceTo(direction)).toBeLessThan(1e-9);
    // A step smaller than a texel's worth leaves the shadow camera where it was.
    view.focusShadows(1234.5 + texel * 0.1, -678.25);
    expect(sun.target.position.distanceTo(target)).toBeLessThan(texel);

    // Strong by day, fainter as the sun sinks, none at night: then the map is not drawn at all.
    const material = ground.material as ShadowMaterial;
    const noon = material.opacity;
    expect(ground.visible).toBe(true);
    expect(sun.shadow.autoUpdate).toBe(true);
    view.applySky(skyAt(3), placed(toward(3, 245)));
    expect(material.opacity).toBeLessThan(noon);
    expect(material.opacity).toBeGreaterThan(0.1);
    view.applySky(skyAt(-25), placed(toward(-25, 330)));
    expect(ground.visible).toBe(false);
    expect(sun.shadow.autoUpdate).toBe(false);
    view.applySky(skyAt(48), placed(DAY_SUN));
    expect(sun.shadow.autoUpdate).toBe(true);
    expect(sun.shadow.needsUpdate).toBe(true);

    // The ground's shadows fade out toward its edges, so no line shows where the map ends.
    const shader = { uniforms: {}, vertexShader: ShaderLib.shadow.vertexShader, fragmentShader: ShaderLib.shadow.fragmentShader };
    material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.fragmentShader).toContain('opacity * edge * ( 1.0 - getShadowMask() )');
    expect(shader.vertexShader).toContain('vShadowUv = uv;');

    view.dispose();
    expect(scene.children).toEqual([]);
  });

  it('turns the baked shadow decals away from the key light', () => {
    const view = new EnvironmentView(new Scene());
    const prelit = new PrelitMaterials();

    view.applySky(skyAt(20, 'clear', true), placed(toward(20, 100)), prelit);
    // A morning sun in the east: the shadows fall west (-x), long.
    expect(prelit.shadowReach.value.x).toBeLessThan(-2);
    expect(Math.abs(prelit.shadowReach.value.y)).toBeLessThan(0.6);
    view.applySky(skyAt(20), placed(toward(20, 260)), prelit);
    expect(prelit.shadowReach.value.x).toBeGreaterThan(2);
  });

  it('releases every GPU resource and restores the scene on dispose', () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    view.dispose();

    expect([...resources].filter((resource) => !disposed.has(resource))).toEqual([]);
    expect(scene.children).toEqual([]);
    expect(scene.background).toBeNull();
    expect(scene.fog).toBeNull();
  });
});
