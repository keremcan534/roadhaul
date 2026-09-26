import {
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  BoxGeometry,
  PerspectiveCamera,
  Vector3,
  type Material,
} from 'three';
import { describe, expect, it } from 'vitest';
import { unlitByLamps } from '../../../../src/presentation/world/LampLighting';
import { keptFromSnow, SeasonShading } from '../../../../src/presentation/world/SeasonShading';

const CAMERA = new PerspectiveCamera();

function compiled(material: Material): { uniforms: Record<string, unknown>; fragmentShader: string } {
  const shader = { uniforms: {} as Record<string, unknown>, vertexShader: '', fragmentShader: '#include <common>\n#include <normal_fragment_maps>' };
  material.onBeforeCompile(shader as never, undefined as never);
  return shader;
}

describe('SeasonShading', () => {
  it('turns the land to a new season over a moment, and shows it', () => {
    const seasons = new SeasonShading('summer');
    const u = seasons.uniforms;
    expect(u.seasonWeights.value.toArray()).toEqual([0, 1, 0, 0]);
    const summerGrass = u.seasonGrass.value.clone();

    seasons.setSeason('winter');
    seasons.update(1.25, 0, CAMERA);
    // Half way: the weights and the look between the two.
    expect(u.seasonWeights.value.y).toBeCloseTo(0.5, 6);
    expect(u.seasonWeights.value.w).toBeCloseTo(0.5, 6);
    expect(u.seasonLeaves.value.y).toBeCloseTo(0.5, 6);
    seasons.update(5, 0, CAMERA);
    expect(u.seasonWeights.value.toArray()).toEqual([0, 0, 0, 1]);
    expect(seasons.shown).toBe('winter');
    expect(u.seasonGrass.value.equals(summerGrass)).toBe(false);
    // Bare trees and no flowers in winter; blossom and flowers in spring, at once when asked.
    expect(u.seasonLeaves.value.y).toBe(1);
    expect(u.seasonFlowers.value).toBe(0);
    seasons.setSeason('spring', true);
    expect(u.seasonLeaves.value.z).toBe(1);
    expect(u.seasonFlowers.value).toBe(1);
    // Autumn turns the leaves.
    seasons.setSeason('autumn', true);
    expect(u.seasonLeaves.value.x).toBe(1);
  });

  it('lays the snow the weather says, and knows the way up as the camera sees it', () => {
    const seasons = new SeasonShading('winter');
    const camera = new PerspectiveCamera();
    camera.position.set(0, 5, 10);
    camera.lookAt(0, 0, 0);

    seasons.update(1 / 60, 0.7, camera);
    expect(seasons.uniforms.snowCover.value).toBe(0.7);
    const up = new Vector3(0, 1, 0).transformDirection(camera.matrixWorldInverse);
    expect(seasons.uniforms.snowUp.value.distanceTo(up)).toBeLessThan(1e-9);
    seasons.update(1 / 60, 3, camera);
    expect(seasons.uniforms.snowCover.value).toBe(1);
  });

  it('lets snow settle on what faces up in the lit materials, once each, and leaves out what should stay clear', () => {
    const seasons = new SeasonShading();
    const lambert = new MeshLambertMaterial();
    const phong = new MeshPhongMaterial();
    const standard = new MeshStandardMaterial();
    const plain = new MeshBasicMaterial();
    const person = new MeshLambertMaterial();
    const sky = new MeshLambertMaterial();
    const marked = new MeshLambertMaterial();
    keptFromSnow(marked);
    const box = new BoxGeometry();
    const people = new Mesh(box, person);
    keptFromSnow(people);
    const backdrop = new Group().add(new Mesh(box, sky));
    unlitByLamps(backdrop);
    const root = new Group().add(new Mesh(box, [lambert, phong]), new Mesh(box, standard), new Mesh(box, plain), new Mesh(box, marked), people, backdrop);

    seasons.shadeScene(root);
    seasons.shadeScene(root);

    for (const material of [lambert, phong, standard]) {
      const shader = compiled(material);
      expect(shader.fragmentShader.split('snowFacing').length - 1, material.type).toBe(2);
      expect(shader.uniforms['snowCover']).toBe(seasons.uniforms.snowCover);
      expect(material.customProgramCacheKey()).toMatch(/\|snow$/);
    }
    for (const material of [plain, person, sky, marked]) {
      expect(compiled(material).fragmentShader, material.type).not.toContain('snowFacing');
    }
  });
});
