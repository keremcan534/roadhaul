import {
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Scene,
  ShaderMaterial,
  type Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { WEATHER } from '../../../../src/data/content/weather';
import type { WeatherLook } from '../../../../src/data/definitions/WeatherDefinition';
import { EnvironmentView } from '../../../../src/presentation/world/EnvironmentView';
import { PrelitMaterials, SUN_DIRECTION } from '../../../../src/presentation/world/lighting';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

function look(weatherId: string): WeatherLook {
  return WEATHER.find((weather) => weather.id === weatherId)!.look;
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
    expect(drawCallCount(scene)).toBeLessThanOrEqual(3);
  });

  it('keeps the sky, clouds and hills centred on the camera', () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene);
    const backdrop = scene.children.find((child) => child.children.length === 3)!;

    view.update({ x: 120, z: -340 });

    expect(backdrop.position.toArray()).toEqual([120, 0, -340]);
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
    let clouds: InstancedMesh | undefined;
    scene.traverse((object) => {
      if (object instanceof InstancedMesh) clouds = object;
    });
    const background = scene.background as Color;

    view.applyWeather(clear, clear, 1, prelit);
    const day = { sun: sun.intensity, sky: sky.intensity, background: background.clone(), clouds: clouds!.count };
    expect(fog.density).toBe(clear.fogDensity);
    expect(ground.color.r).toBeCloseTo(1, 6);

    view.applyWeather(night, night, 1, prelit);
    expect(fog.density).toBe(night.fogDensity);
    expect(sun.intensity).toBeCloseTo(day.sun * night.sunlight, 9);
    expect(sky.intensity).toBeCloseTo(day.sky * night.skylight, 9);
    expect(background.r + background.g + background.b).toBeLessThan((day.background.r + day.background.g + day.background.b) / 4);
    expect(clouds!.count).toBeLessThan(day.clouds);
    expect(ground.color.g).toBeLessThan(0.4);

    // Halfway from clear to rain: the haze halfway between the two.
    view.applyWeather(clear, rain, 0.5, prelit);
    expect(fog.density).toBeCloseTo((clear.fogDensity + rain.fogDensity) / 2, 12);
    expect(clouds!.count).toBe(Math.round(48 * (clear.cloudCover + rain.cloudCover) / 2));
  });

  it('lowers the sun at dusk and dawn: warm, low light, a glowing horizon, and less of it on flat ground', () => {
    const scene = new Scene();
    const view = new EnvironmentView(scene);
    const prelit = new PrelitMaterials();
    const ground = prelit.add(new MeshBasicMaterial({ color: 0xffffff }));
    const sun = scene.children.find((child) => child instanceof DirectionalLight)!;
    let dome: Mesh | undefined;
    scene.traverse((object) => {
      if (object instanceof Mesh && object.material instanceof ShaderMaterial) dome = object;
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
