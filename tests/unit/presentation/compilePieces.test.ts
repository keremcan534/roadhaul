import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PointLight, Points, Scene } from 'three';
import { compilePieces } from '../../../src/presentation/compilePieces';

describe('compilePieces', () => {
  it('goes down through the groups to the things that draw, hidden ones too, each with what hangs under it', () => {
    const scene = new Scene();
    const material = new MeshBasicMaterial();
    const truck = new Mesh(new BoxGeometry(), material);
    const wheel = new Mesh(new BoxGeometry(), material);
    truck.add(wheel);
    const rain = new Points();
    rain.visible = false;
    const town = new Group();
    const house = new Mesh(new BoxGeometry(), material);
    const yard = new Group();
    const crate = new Mesh(new BoxGeometry(), material);
    yard.add(crate);
    town.add(house, yard);
    scene.add(truck, rain, new PointLight(), town);

    expect(compilePieces(scene)).toEqual([truck, rain, house, crate]);
  });
});
