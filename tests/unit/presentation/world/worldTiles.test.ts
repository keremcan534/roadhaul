import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import type { RoadDefinition } from '../../../../src/data/definitions/MapDefinition';
import { RoadPath } from '../../../../src/domain/world/RoadPath';
import { ribbonRows } from '../../../../src/presentation/world/roadRibbons';
import {
  COUNTRY_TILE_METERS,
  FAR_CULL_METERS,
  FarCulling,
  TileParts,
  tileKeyOf,
  tileRuns,
} from '../../../../src/presentation/world/worldTiles';

function road(controlPoints: RoadDefinition['controlPoints'], closed = false): RoadPath {
  return new RoadPath({ id: 'test_road', kind: 'lane', widthMeters: 5.5, closed, controlPoints });
}

/** A box `size` meters wide standing at (x, z). */
function box(x: number, z: number, size = 10): Mesh {
  return new Mesh(new BoxGeometry(size, size, size).translate(x, size / 2, z), new MeshBasicMaterial());
}

describe('world tiles', () => {
  it('files a point by the tile it lies in, the negative side included', () => {
    const tile = COUNTRY_TILE_METERS;
    expect(tileKeyOf(1, 1)).toBe('0,0');
    expect(tileKeyOf(tile - 0.01, tile + 0.01)).toBe('0,1');
    expect(tileKeyOf(-1, -tile - 1)).toBe('-1,-2');
    expect(tileKeyOf(250, -250, 100)).toBe('2,-3');

    const parts = new TileParts<string>();
    parts.add(10, 10, 'a');
    parts.add(20, 30, 'b');
    parts.add(-10, 10, 'c');
    expect([...parts.tiles]).toEqual([
      ['0,0', ['a', 'b']],
      ['-1,0', ['c']],
    ]);
  });

  it('cuts a road\'s ribbon where it crosses from tile to tile, the runs sharing a row where they meet', () => {
    const path = road([
      [-1500, 100],
      [-700, 300],
      [200, 150],
      [1300, 500],
    ]);
    const rows = ribbonRows(path);
    const runs = tileRuns(path, rows);

    expect(runs.length).toBeGreaterThanOrEqual(4);
    // Every row is in a run, in order, and each run starts where the one before ends.
    expect(runs.flatMap((run, index) => (index === 0 ? run.rows : run.rows.slice(1)))).toEqual(rows);
    for (let index = 1; index < runs.length; index++) {
      expect(runs[index]!.rows[0]).toBe(runs[index - 1]!.rows.at(-1));
    }
    // Each run's pieces lie in the tile it is filed in, and the next run's in another.
    const count = path.pointCount;
    const keys = runs.map((run) => {
      const key = tileKeyOf(run.x, run.z);
      for (let piece = 0; piece + 1 < run.rows.length; piece++) {
        const a = run.rows[piece]! % count;
        const b = run.rows[piece + 1]! % count;
        expect(tileKeyOf((path.x(a) + path.x(b)) / 2, (path.z(a) + path.z(b)) / 2)).toBe(key);
      }
      return key;
    });
    for (let index = 1; index < keys.length; index++) {
      expect(keys[index]).not.toBe(keys[index - 1]);
    }
  });

  it('keeps a road within one tile in a single run, and a closed one closes its loop', () => {
    const short = road([
      [100, 100],
      [300, 200],
    ]);
    const rows = ribbonRows(short);
    expect(tileRuns(short, rows)).toEqual([{ x: expect.any(Number), z: expect.any(Number), rows }]);

    const loop = road(
      [
        [-300, -300],
        [300, -300],
        [300, 300],
        [-300, 300],
      ],
      true,
    );
    const loopRows = ribbonRows(loop);
    const runs = tileRuns(loop, loopRows);
    expect(runs.at(-1)!.rows.at(-1)).toBe(loop.pointCount);
    expect(new Set(runs.map((run) => tileKeyOf(run.x, run.z)))).toEqual(new Set(['-1,-1', '0,-1', '0,0', '-1,0']));
  });

  it('shows what comes within reach of the camera and hides what lies further off', () => {
    const culling = new FarCulling();
    const near = box(0, 0);
    const edge = new Group().add(box(FAR_CULL_METERS - 20, 0), box(FAR_CULL_METERS + 600, 0));
    const far = box(0, FAR_CULL_METERS + 300);
    const empty = new Group();
    for (const object of [near, edge, far, empty]) {
      culling.add(object);
    }
    // Nothing to draw, nothing to cull.
    expect(culling.size).toBe(3);

    culling.update(0, 0);
    expect([near.visible, edge.visible, far.visible]).toEqual([true, true, false]);
    // Reach runs to the nearest edge of what the object covers, not its middle.
    culling.update(300, 400);
    expect([near.visible, edge.visible, far.visible]).toEqual([true, true, true]);
    culling.update(-FAR_CULL_METERS - 100, 0);
    expect([near.visible, edge.visible, far.visible]).toEqual([false, false, false]);
    culling.update(0, 0);
    expect(near.visible).toBe(true);
  });

  it('takes as many objects as it is given', () => {
    const culling = new FarCulling(50);
    const boxes = Array.from({ length: 40 }, (_, index) => box(index * 100, 0));
    for (const object of boxes) {
      culling.add(object);
    }
    culling.update(1000, 0);
    expect(boxes.filter((object) => object.visible).map((object) => boxes.indexOf(object))).toEqual([10]);
  });
});
