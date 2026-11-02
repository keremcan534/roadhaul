import { BatchedMesh, Box3, DoubleSide, InstancedMesh, Matrix4, Mesh, Scene, ShaderMaterial, type BufferAttribute } from 'three';
import { DebrisSimulation } from '../../../../src/domain/crash/DebrisSimulation';
import { KNOCKABLES, knockableCode } from '../../../../src/domain/crash/knockables';
import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../../src/data/content/maps';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { KERB_HEIGHT_METERS, OUTLINE_ROW } from '../../../../src/domain/world/townscape';
import { keptSidewalkRows, SceneryView } from '../../../../src/presentation/world/SceneryView';
import { FAR_CULL_METERS } from '../../../../src/presentation/world/worldTiles';
import { mapFixture } from '../../../support/contentFixtures';
import { batchTiles, drawCallCount, gpuResources, watchDisposal, type BatchTile } from '../../../support/threeResources';

const world = new DrivingWorld(MAPS[0]!);

/** The view's meshes whose names start with `prefix`. */
function meshes(scene: Scene, prefix: string): Mesh[] {
  const found: Mesh[] = [];
  scene.traverse((object) => {
    if (object instanceof Mesh && object.name.startsWith(prefix)) {
      found.push(object);
    }
  });
  return found;
}

/** The props' batch (its tiles) or the pavements'. */
function batchOf(scene: Scene, name: 'scenery:tiles' | 'scenery:pavements'): BatchedMesh {
  return scene.getObjectByName(name) as BatchedMesh;
}

/** The tiles of the props and of the pavements. */
function tilesOf(scene: Scene): { props: BatchTile[]; pavements: BatchTile[] } {
  const tiles = (name: 'scenery:tiles' | 'scenery:pavements'): BatchTile[] => {
    const batch = batchOf(scene, name);
    return batch === undefined ? [] : batchTiles(batch);
  };
  return { props: tiles('scenery:tiles'), pavements: tiles('scenery:pavements') };
}

/** How far (x, z) lies from a box on the ground. */
function distanceToBox(box: Box3, x: number, z: number): number {
  return Math.hypot(Math.max(box.min.x - x, 0, x - box.max.x), Math.max(box.min.z - z, 0, z - box.max.z));
}

/** The matrices of an instanced mesh's instances, flattened. */
function matricesOf(mesh: InstancedMesh): number[] {
  return Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16));
}

describe('SceneryView', () => {
  it('merges what keeps still per 600 m tile, each within its square and the few meters a long piece reaches out', () => {
    const scene = new Scene();
    const view = new SceneryView(scene, world);
    const { props, pavements } = tilesOf(scene);

    expect(view.counts.tiles).toBe(props.length);
    expect(view.counts.tiles).toBeGreaterThan(8);
    expect(pavements.length).toBeGreaterThan(0);
    for (const { box } of [...props, ...pavements]) {
      // A fence's rail, a wall's stretch or a piece of pavement is filed where its middle is: the tile's square is
      // the one its middle lies in, give or take what reaches out of it.
      const reach = 60;
      const column = Math.floor((box.min.x + box.max.x) / 2 / 600);
      const row = Math.floor((box.min.z + box.max.z) / 2 / 600);
      expect(box.max.x - box.min.x).toBeLessThan(600 + 2 * reach);
      expect(box.max.z - box.min.z).toBeLessThan(600 + 2 * reach);
      expect(box.min.x).toBeGreaterThan(column * 600 - reach);
      expect(box.max.x).toBeLessThan((column + 1) * 600 + reach);
      expect(box.min.z).toBeGreaterThan(row * 600 - reach);
      expect(box.max.z).toBeLessThan((row + 1) * 600 + reach);
      expect(box.min.y).toBeGreaterThanOrEqual(-0.5);
      expect(box.max.y).toBeLessThan(9);
    }
  });

  it("lays the pavements' flagstones level with the kerbs' tops", () => {
    const scene = new Scene();
    new SceneryView(scene, world);

    const pavements = batchOf(scene, 'scenery:pavements');
    const position = pavements.geometry.getAttribute('position') as BufferAttribute;
    const tiles = batchTiles(pavements);
    expect(tiles.length).toBeGreaterThan(0);
    for (const { vertexStart, vertexCount } of tiles) {
      for (let index = vertexStart; index < vertexStart + vertexCount; index += 11) {
        expect(position.getY(index)).toBeCloseTo(0.03 + KERB_HEIGHT_METERS, 6);
      }
    }
  });

  it('hangs the wires between neighbouring poles, sagging, and the highway fence\'s straight, a pixel wide at least, a draw a tile', () => {
    const scene = new Scene();
    const view = new SceneryView(scene, world);
    const tiles = meshes(scene, 'scenery:wires:');
    const spans = world.powerLines.reduce((sum, line) => sum + line.poles.length - 1, 0);
    const fenceSpans = world.roadFences.reduce((sum, fence) => sum + fence.points.length - 1, 0);
    expect(fenceSpans).toBeGreaterThan(0);
    expect(tiles.length).toBeGreaterThan(1);

    // The power lines: three wires a span, eight pieces each, four corners a piece; and the fences' two straight ones.
    const powerCorners = spans * 3 * 8 * 4;
    let corners = 0;
    let fenceHighest = -Infinity;
    let lowest = Infinity;
    let highest = -Infinity;
    for (const tile of tiles) {
      const position = tile.geometry.getAttribute('position') as BufferAttribute;
      corners += position.count;
      expect(tile.frustumCulled).toBe(false);
      expect(tile.material).toBe(tiles[0]!.material);
      for (let index = 0; index < position.count; index++) {
        const y = position.getY(index);
        if (y < 2) {
          fenceHighest = Math.max(fenceHighest, y);
        } else {
          lowest = Math.min(lowest, y);
          highest = Math.max(highest, y);
        }
      }
    }
    expect(corners).toBe(powerCorners + fenceSpans * 2 * 4);
    expect(fenceHighest).toBeLessThan(1.2);
    // From the insulators' tops, sagging less than a meter.
    expect(highest).toBeCloseTo(7.9 + 0.06 + 0.16, 5);
    expect(highest - lowest).toBeGreaterThan(0.3);
    expect(highest - lowest).toBeLessThan(1);

    const material = tiles[0]!.material as ShaderMaterial;
    expect(material.transparent).toBe(true);
    expect(material.side).toBe(DoubleSide);
    expect(material.fog).toBe(true);
    view.setViewport(1280, 720);
    expect(material.uniforms['resolution']!.value.toArray()).toEqual([1280, 720]);
    view.setViewport(0, 0);
    expect(material.uniforms['resolution']!.value.toArray()).toEqual([1, 1]);
  });

  it('puts every animal out to graze, turning and shuffling within its place as it crops the grass', () => {
    const scene = new Scene();
    const view = new SceneryView(scene, world);
    const sheep = world.grazers.filter((grazer) => grazer.kind === 'sheep').length;
    const cows = world.grazers.length - sheep;
    const bodies = scene.getObjectByName('scenery:sheep') as InstancedMesh;
    const heads = scene.getObjectByName('scenery:sheep-heads') as InstancedMesh;

    expect(view.counts.animals).toBe(world.grazers.length);
    expect(bodies.count).toBe(sheep);
    expect((scene.getObjectByName('scenery:cow') as InstancedMesh).count).toBe(cows);
    // Each body where its animal stands, give or take its shuffle (within its solid circle in the world).
    const matrix = new Matrix4();
    const first = world.grazers.find((grazer) => grazer.kind === 'sheep')!;
    const near = (): number => {
      bodies.getMatrixAt(0, matrix);
      return Math.hypot(matrix.elements[12]! - first.x, matrix.elements[14]! - first.z);
    };
    expect(near()).toBeLessThanOrEqual(0.41);

    const still = { bodies: matricesOf(bodies), heads: matricesOf(heads) };
    view.update(0);
    expect(matricesOf(heads)).toEqual(still.heads);
    expect(matricesOf(bodies)).toEqual(still.bodies);
    for (let second = 0; second < 30; second++) {
      view.update(1);
      expect(near()).toBeLessThanOrEqual(0.41);
    }
    expect(matricesOf(heads)).not.toEqual(still.heads);
    expect(matricesOf(bodies)).not.toEqual(still.bodies);
  });

  it('draws the tiles near the camera only', () => {
    const scene = new Scene();
    const view = new SceneryView(scene, world);
    const { x, z } = world.spawn;
    view.showAround(x, z);
    const { props, pavements } = tilesOf(scene);
    const tiles = [...props, ...pavements];

    const shown = tiles.filter((tile) => tile.visible);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(tiles.length / 3);
    for (const tile of tiles) {
      expect(tile.visible).toBe(distanceToBox(tile.box, x, z) <= FAR_CULL_METERS);
    }
    // Far off, nothing of them is drawn, not even an empty draw.
    view.showAround(1e6, 1e6);
    expect(batchOf(scene, 'scenery:tiles').visible).toBe(false);
    expect(batchOf(scene, 'scenery:pavements').visible).toBe(false);
    view.showAround(x, z);
    // The wires' tiles too, in larger tiles.
    const wires = meshes(scene, 'scenery:wires:');
    expect(wires.some((mesh) => mesh.visible)).toBe(true);
    for (const mesh of wires) {
      const box = new Box3().setFromObject(mesh);
      const distance = Math.hypot(Math.max(box.min.x - x, 0, x - box.max.x), Math.max(box.min.z - z, 0, z - box.max.z));
      expect(mesh.visible, mesh.name).toBe(distance <= FAR_CULL_METERS);
    }
  });

  it('draws into the shadow map only the animals that can cast round the truck, given where shadows reach', () => {
    const scene = new Scene();
    const first = world.grazers[0]!;
    const reach = { shadowStamp: 0, shadowReaches: (x: number, z: number) => x === first.x && z === first.z };
    const view = new SceneryView(scene, world, { castShadows: true, shadowReach: reach });
    const kind = first.kind;
    const bodies = scene.getObjectByName(`scenery:${kind}`) as InstancedMesh;
    const shadowBodies = scene.getObjectByName(`scenery:${kind}:shadow`) as InstancedMesh;
    const shadowHeads = scene.getObjectByName(`scenery:${kind}-heads:shadow`) as InstancedMesh;
    expect(bodies.castShadow).toBe(false);

    view.update(0.5);
    for (const mesh of [shadowBodies, shadowHeads]) {
      (mesh.onBeforeShadow as () => void)();
      expect(mesh.count, mesh.name).toBe(1);
      (mesh.onAfterShadow as () => void)();
    }
    // The same body as drawn, as it stands this moment.
    const drawn = new Matrix4();
    const cast = new Matrix4();
    const slot = world.grazers.filter((grazer) => grazer.kind === kind).indexOf(first);
    bodies.getMatrixAt(slot, drawn);
    shadowBodies.getMatrixAt(0, cast);
    expect(cast.elements).toEqual(drawn.elements);
    view.dispose();
  });

  it('costs a draw for all the tiles, one for the pavements, one a tile of the wires and two a kind of animal, and casts shadows only when asked', () => {
    const scene = new Scene();
    new SceneryView(scene, world, { castShadows: true });
    const wires = meshes(scene, 'scenery:wires:').length;

    expect(drawCallCount(scene)).toBe(1 + 1 + wires + 2 * 2);
    expect(meshes(scene, 'scenery:').filter((mesh) => mesh.name !== 'scenery:pavements' && !mesh.name.startsWith('scenery:wires')).every((mesh) => mesh.castShadow)).toBe(true);
    const plain = new Scene();
    new SceneryView(plain, world);
    expect(meshes(plain, 'scenery:').some((mesh) => mesh.castShadow)).toBe(false);
  });

  it('draws nothing for a map without the scenery, and lets it be', () => {
    const scene = new Scene();
    const view = new SceneryView(scene, new DrivingWorld(mapFixture()));

    expect(view.counts).toEqual({ tiles: 0, animals: 0 });
    expect(drawCallCount(scene)).toBe(0);
    view.update(1);
    view.dispose();
  });

  it("empties the place of what is knocked over, uploading only its vertices, and fills it again once it stands", () => {
    const street = new DrivingWorld(mapFixture({ scenery: { seed: 1, treesPerKilometer: 0, streetscape: true } }));
    const scene = new Scene();
    const view = new SceneryView(scene, street, { debrisCapacity: 4 });
    const bin = street.streetFurniture.find((item) => item.kind === 'bin')!;
    const circle = street.circleIndexOf(bin);
    const position = batchOf(scene, 'scenery:tiles').geometry.getAttribute('position') as BufferAttribute;
    const standing = Float32Array.from(position.array as Float32Array);
    const knocked = new Uint8Array(street.knocked.length);

    knocked[circle] = 1;
    view.showKnocked(knocked, 1);

    expect(position.updateRanges).toHaveLength(1);
    const { start, count } = position.updateRanges[0]!;
    expect(count).toBeGreaterThan(30);
    const array = position.array as Float32Array;
    // All of it squeezed to one point, where the bin stood; nothing else moved.
    expect(Math.hypot(array[start]! - bin.x, array[start + 2]! - bin.z)).toBeLessThan(0.6);
    for (let k = start; k < start + count; k += 3) {
      expect([array[k], array[k + 1], array[k + 2]]).toEqual([array[start], array[start + 1], array[start + 2]]);
    }
    const outside = (values: ArrayLike<number>): number[] => [...Array.from(values).slice(0, start), ...Array.from(values).slice(start + count)];
    expect(outside(array)).toEqual(outside(standing));

    knocked[circle] = 0;
    view.showKnocked(knocked, 2);
    expect(Array.from(array)).toEqual(Array.from(standing));
  });

  it('draws the furniture and the speed signs knocked over tumbling about, each in its own look', () => {
    const street = new DrivingWorld(
      mapFixture({ halfSizeMeters: 600, scenery: { seed: 1, treesPerKilometer: 0, streetscape: true } }),
    );
    const scene = new Scene();
    const view = new SceneryView(scene, street, { debrisCapacity: 4 });
    const debris = new DebrisSimulation(4);
    const drop = (kind: 'bin' | 'speedSign', ref: number): void => {
      const shape = KNOCKABLES[kind].shape;
      debris.launch({ kind: knockableCode(kind), ref, shape, x: 0, y: 2, z: 0, heading: 0, vx: 0, vy: 0, vz: 0, spinX: 0, spinY: 0, spinZ: 0 });
    };
    drop('bin', street.circleIndexOf(street.streetFurniture.find((item) => item.kind === 'bin')!));
    const sign = street.speedSigns[0];
    if (sign !== undefined) drop('speedSign', street.circleIndexOf(sign));

    view.drawDebris(debris, 1);

    const shown = meshes(scene, 'scenery:fallen:').filter((mesh) => mesh.visible);
    expect(shown.map((mesh) => mesh.name).sort()).toEqual(
      ['scenery:fallen:bin', ...(sign === undefined ? [] : [`scenery:fallen:speed:${sign.limitKmh}`])].sort(),
    );
    view.drawDebris(null, 1);
    expect(meshes(scene, 'scenery:fallen:').some((mesh) => mesh.visible)).toBe(false);
  });

  it('stands the country roads\' signs in the tiles, and draws one knocked over in its own look', () => {
    const roads = [
      { id: 'main_road', kind: 'rural', widthMeters: 8, closed: false, controlPoints: [[-560, 0], [0, 0], [560, 0]] },
      { id: 'north_road', kind: 'rural', widthMeters: 8, closed: false, controlPoints: [[0, 0], [0, 500]] },
    ] as const;
    const signed = new DrivingWorld(
      mapFixture({
        halfSizeMeters: 600,
        roads: roads.map((road) => ({ ...road, controlPoints: road.controlPoints.map(([x, z]) => [x, z] as const) })),
        buildings: [],
        depots: [],
        scenery: { seed: 3, treesPerKilometer: 0, roadSigns: true },
      }),
    );
    const scene = new Scene();
    const view = new SceneryView(scene, signed, { debrisCapacity: 2 });
    const kinds = [...new Set(signed.roadSigns.map((sign) => sign.kind))].sort();
    expect(kinds).toEqual(['sideRoadLeft', 'sideRoadRight', 'stop']);
    // Merged into the tiles: a look for each kind to fall in, none drawn while they stand.
    expect(meshes(scene, 'scenery:fallen:sign:').map((mesh) => mesh.name).sort()).toEqual(kinds.map((kind) => `scenery:fallen:sign:${kind}`));
    expect(meshes(scene, 'scenery:fallen:').some((mesh) => mesh.visible)).toBe(false);

    const stop = signed.roadSigns.find((sign) => sign.kind === 'stop')!;
    const debris = new DebrisSimulation(2);
    const shape = KNOCKABLES.roadSign.shape;
    debris.launch({ kind: knockableCode('roadSign'), ref: signed.circleIndexOf(stop), shape, x: 0, y: 2, z: 0, heading: 0, vx: 0, vy: 0, vz: 0, spinX: 0, spinY: 0, spinZ: 0 });
    view.drawDebris(debris, 1);

    expect(meshes(scene, 'scenery:fallen:').filter((mesh) => mesh.visible).map((mesh) => mesh.name)).toEqual(['scenery:fallen:sign:stop']);
  });

  it('draws the hedgerows in the tiles, and a farm gate\'s mailbox knocked over in its own look', () => {
    const edged = new DrivingWorld(
      mapFixture({
        halfSizeMeters: 600,
        roads: [
          { id: 'main_road', kind: 'rural', widthMeters: 8, closed: false, controlPoints: [[-560, 0], [0, 0], [560, 0]] },
          { id: 'farm_lane', kind: 'lane', widthMeters: 5.5, closed: false, controlPoints: [[0, 0], [0, 300]] },
        ],
        buildings: [],
        depots: [],
        spawn: { x: 0, z: -300, headingDegrees: 90 },
        scenery: { seed: 3, treesPerKilometer: 0, countryside: true },
      }),
    );
    const scene = new Scene();
    const view = new SceneryView(scene, edged, { debrisCapacity: 2 });
    expect(edged.hedgerows.length).toBeGreaterThan(0);
    // The hedges add to the tiles' vertices: a chunk is twenty of them (its two sides, its hump), more at the hedge's ends.
    const vertices = tilesOf(scene).props.reduce((sum, tile) => sum + tile.vertexCount, 0);
    const chunks = edged.hedgerows.reduce((sum, hedge) => sum + hedge.points.length - 1, 0);
    expect(vertices).toBeGreaterThan(chunks * 20);

    expect(edged.farmGates).toHaveLength(1);
    const { mailbox } = edged.farmGates[0]!;
    const debris = new DebrisSimulation(2);
    const shape = KNOCKABLES.mailbox.shape;
    debris.launch({ kind: knockableCode('mailbox'), ref: edged.circleIndexOf(mailbox), shape, x: 0, y: 1, z: 0, heading: 0, vx: 0, vy: 0, vz: 0, spinX: 0, spinY: 0, spinZ: 0 });
    view.drawDebris(debris, 1);

    const shown = meshes(scene, 'scenery:fallen:').filter((mesh) => mesh.visible).map((mesh) => mesh.name);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatch(/^scenery:fallen:mailbox:\d$/);
  });

  it('frees everything it made', () => {
    const scene = new Scene();
    const view = new SceneryView(scene, world);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    view.dispose();

    expect(scene.children).toHaveLength(0);
    expect([...resources].filter((resource) => !disposed.has(resource))).toEqual([]);
  });
});

describe('keptSidewalkRows', () => {
  /** An outline (along, kerb x, z, back x, z per row) every 2 m along `centre`, the kerb 1 m off it and the back 3 m. */
  const outline = (rows: number, centre: (along: number) => readonly [number, number, number, number]): Float64Array => {
    const values = new Float64Array(rows * OUTLINE_ROW);
    for (let row = 0; row < rows; row++) {
      const [x, z, acrossX, acrossZ] = centre(row * 2);
      values.set([row * 2, x + acrossX, z + acrossZ, x + acrossX * 3, z + acrossZ * 3], row * OUTLINE_ROW);
    }
    return values;
  };

  it('draws a straight pavement through its two ends only', () => {
    const straight = outline(41, (along) => [10, along, 1, 0]);
    expect(keptSidewalkRows(straight, 0, 40)).toEqual([0, 40]);
  });

  it('keeps the rows round a corner, where the kerb bends', () => {
    // 20 m straight, then a quarter turn of 12 m radius, then straight again.
    const bend = outline(41, (along) => {
      if (along <= 20) {
        return [0, along, 1, 0];
      }
      const angle = Math.min(Math.PI / 2, (along - 20) / 12);
      const extra = Math.max(0, along - 20 - (12 * Math.PI) / 2);
      return [-12 + 12 * Math.cos(angle) - extra, 20 + 12 * Math.sin(angle), Math.cos(angle), Math.sin(angle)];
    });
    const kept = keptSidewalkRows(bend, 0, 40);
    expect(kept[0]).toBe(0);
    expect(kept[kept.length - 1]).toBe(40);
    // None left out on the straight before the turn but its end; most kept round it.
    expect(kept[1]).toBeGreaterThanOrEqual(9);
    expect(kept.filter((row) => row > 10 && row < 20).length).toBeGreaterThan(5);
    expect(kept.length).toBeLessThan(30);
  });
});
