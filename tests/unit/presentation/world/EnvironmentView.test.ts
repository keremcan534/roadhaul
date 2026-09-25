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
} from 'three';
import { describe, expect, it } from 'vitest';
import { WEATHER } from '../../../../src/data/content/weather';
import type { WeatherLook } from '../../../../src/data/definitions/WeatherDefinition';
import { CLOUD_COUNT, EnvironmentView, PUFFS_PER_CLOUD } from '../../../../src/presentation/world/EnvironmentView';
import { PrelitMaterials, SUN_DIRECTION } from '../../../../src/presentation/world/lighting';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

function look(weatherId: string): WeatherLook {
  return WEATHER.find((weather) => weather.id === weatherId)!.look;
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

  it('puts out the stars and the moon at night, where the light comes from, and hides them by day', () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene);
    const sun = scene.children.find((child) => child instanceof DirectionalLight)!;
    const { stars, moon } = nightSky(scene);

    view.applyWeather(look('clear'), look('clear'), 1);
    expect(stars.visible).toBe(false);
    expect(moon.visible).toBe(false);

    view.applyWeather(look('night'), look('night'), 1);
    expect(stars.visible).toBe(true);
    expect((stars.material as ShaderMaterial).uniforms['level']!.value).toBe(1);
    expect(moon.visible).toBe(true);
    expect((moon.material as MeshBasicMaterial).opacity).toBe(1);
    const light = sun.position.clone().normalize();
    expect(moon.position.clone().normalize().distanceTo(light)).toBeLessThan(1e-9);
    // Low enough to see over the road ahead, and facing the camera at the centre.
    expect(light.y).toBeGreaterThan(0.15);
    expect(light.y).toBeLessThan(0.4);
    const facing = new Vector3(0, 0, 1).applyQuaternion(moon.quaternion);
    expect(facing.dot(light)).toBeCloseTo(-1, 9);

    // The first stars come out at dusk, without the moon.
    view.applyWeather(look('dusk'), look('dusk'), 1);
    expect(stars.visible).toBe(true);
    expect((stars.material as ShaderMaterial).uniforms['level']!.value).toBeLessThan(0.3);
    expect(moon.visible).toBe(false);
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

  it('turns sky, haze, light, clouds and the pre-lit ground to the weather, and blends between two', () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene);
    const prelit = new PrelitMaterials();
    const ground = prelit.add(new MeshBasicMaterial({ color: 0xffffff }));
    const [clear, rain, night] = [look('clear'), look('rain'), look('night')];
    const fog = scene.fog as FogExp2;
    const sun = scene.children.find((child) => child instanceof DirectionalLight)!;
    const sky = scene.children.find((child) => child instanceof HemisphereLight)!;
    const background = scene.background as Color;

    view.applyWeather(clear, clear, 1, prelit);
    const day = { sun: sun.intensity, sky: sky.intensity, background: background.clone(), clouds: view.cloudCount };
    expect(fog.density).toBe(clear.fogDensity);
    expect(ground.color.r).toBeCloseTo(1, 6);

    view.applyWeather(night, night, 1, prelit);
    expect(fog.density).toBe(night.fogDensity);
    expect(sun.intensity).toBeCloseTo(day.sun * night.sunlight, 9);
    expect(sky.intensity).toBeCloseTo(day.sky * night.skylight, 9);
    expect(background.r + background.g + background.b).toBeLessThan((day.background.r + day.background.g + day.background.b) / 4);
    expect(view.cloudCount).toBeLessThan(day.clouds);
    expect(ground.color.g).toBeLessThan(0.4);

    // Halfway from clear to rain: the haze halfway between the two.
    view.applyWeather(clear, rain, 0.5, prelit);
    expect(fog.density).toBeCloseTo((clear.fogDensity + rain.fogDensity) / 2, 12);
    expect(view.cloudCount).toBe(Math.round((CLOUD_COUNT * (clear.cloudCover + rain.cloudCover)) / 2));
    // Every puff of every cloud shown, in one draw call.
    const puffs = clouds(scene).geometry as InstancedBufferGeometry;
    expect(puffs.instanceCount).toBe(view.cloudCount * PUFFS_PER_CLOUD);
    expect(clouds(scene).visible).toBe(true);
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

    view.applyWeather({ ...look('night'), cloudCover: 0 }, { ...look('night'), cloudCover: 0 }, 1);
    expect(view.cloudCount).toBe(0);
    expect(cloud.visible).toBe(false);
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
    expect(shader.fragmentShader).toContain('mix(gl_FragColor.rgb, hazeColor, vHaze)');
  });

  it('lowers the sun at dusk and dawn: warm, low light, a glowing horizon, and less of it on flat ground', () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene);
    const prelit = new PrelitMaterials();
    const ground = prelit.add(new MeshBasicMaterial({ color: 0xffffff }));
    const sun = scene.children.find((child) => child instanceof DirectionalLight)!;
    let dome: Mesh | undefined;
    scene.traverse((object) => {
      if (object instanceof Mesh && object.material instanceof ShaderMaterial && 'sunLow' in object.material.uniforms) {
        dome = object;
      }
    });
    const uniforms = (dome!.material as ShaderMaterial).uniforms;

    view.applyWeather(look('clear'), look('clear'), 1, prelit);
    const noonGround = ground.color.clone();
    expect(uniforms['sunLow']!.value).toBe(0);
    expect(sun.position.clone().normalize().y).toBeCloseTo(SUN_DIRECTION.y, 6);

    view.applyWeather(look('dusk'), look('dusk'), 1, prelit);
    const low = sun.position.clone().normalize();
    // A few degrees over the horizon, in the same quarter of the sky.
    expect(low.y).toBeLessThan(0.15);
    expect(low.y).toBeGreaterThan(0.03);
    expect(Math.sign(low.x)).toBe(Math.sign(SUN_DIRECTION.x));
    expect(Math.sign(low.z)).toBe(Math.sign(SUN_DIRECTION.z));
    const skySun = uniforms['sunDirection']!.value as Vector3;
    expect(skySun.distanceTo(low)).toBeLessThan(1e-9);
    expect(uniforms['sunLow']!.value).toBeGreaterThan(0.7);
    // The glow is the evening light's colour: more red than blue.
    const glow = uniforms['sunColor']!.value as Color;
    expect(glow.r).toBeGreaterThan(glow.b * 2);
    expect(ground.color.g).toBeLessThan(noonGround.g * 0.8);
  });

  it('grades the picture by the weather: warm at dusk, cool at night, with darker corners and more bloom under lit lamps', () => {
    const view = new EnvironmentView(new Scene());
    const [clear, dusk, night] = [look('clear'), look('dusk'), look('night')];

    view.applyWeather(clear, clear, 1);
    const day = { ...view.grade };
    expect(day).toMatchObject({ saturation: clear.saturation, contrast: clear.contrast, warmth: clear.warmth, bloom: clear.bloom });

    view.applyWeather(dusk, dusk, 1);
    expect(view.grade.warmth).toBeGreaterThan(day.warmth);
    view.applyWeather(night, night, 1);
    const dark = { ...view.grade };
    expect(dark.warmth).toBeLessThan(day.warmth);
    expect(dark.bloom).toBeGreaterThan(day.bloom);
    expect(dark.vignette).toBeGreaterThan(day.vignette);
    // The exposure is the day's in every weather.
    expect(dark.exposure).toBe(day.exposure);

    // Halfway from clear to night: halfway in every figure.
    view.applyWeather(clear, night, 0.5);
    for (const key of ['saturation', 'contrast', 'warmth', 'bloom', 'vignette'] as const) {
      expect(view.grade[key], key).toBeCloseTo((day[key] + dark[key]) / 2, 12);
    }
  });

  it('thins the haze through the colour pass, where fog mixes in linear light and shows more', () => {
    const screen = new Scene();
    const hdr = new Scene();
    const onScreen = new EnvironmentView(screen);
    const throughPass = new EnvironmentView(hdr, { hdr: true });

    for (const weather of WEATHER) {
      onScreen.applyWeather(weather.look, weather.look, 1);
      throughPass.applyWeather(weather.look, weather.look, 1);
      const [plain, linear] = [(screen.fog as FogExp2).density, (hdr.fog as FogExp2).density];
      expect(linear, weather.id).toBeLessThan(plain);
      expect(linear, weather.id).toBeGreaterThan(plain * 0.5);
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

    view.applyWeather(look('clear'), look('clear'), 1);
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
    view.applyWeather(look('dusk'), look('dusk'), 1);
    expect(material.opacity).toBeLessThan(noon);
    expect(material.opacity).toBeGreaterThan(0.1);
    view.applyWeather(look('night'), look('night'), 1);
    expect(ground.visible).toBe(false);
    expect(sun.shadow.autoUpdate).toBe(false);
    view.applyWeather(look('clear'), look('clear'), 1);
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

  it('does nothing while the weather looks the same', () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene);
    const [clear, cloudy] = [look('clear'), look('cloudy')];
    const fog = scene.fog as FogExp2;
    view.applyWeather(clear, cloudy, 0.25);
    fog.density = 0.5;

    view.applyWeather(clear, cloudy, 0.25);
    expect(fog.density).toBe(0.5);

    view.applyWeather(clear, cloudy, 0.3);
    expect(fog.density).not.toBe(0.5);
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
