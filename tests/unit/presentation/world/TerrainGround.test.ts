import { Color, MeshBasicMaterial, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { TerrainGrid } from '../../../../src/domain/world/terrain';
import { NEAR_GROUND_CELL_METERS, NEAR_GROUND_METERS, TerrainGround } from '../../../../src/presentation/world/TerrainGround';

/** The ground drawn (its draw range): how many triangles, and the area they cover on the map, m². */
function drawn(geometry: BufferGeometry): { triangles: number; area: number } {
  const index = geometry.getIndex()!.array;
  const p = geometry.getAttribute('position').array;
  const count = Math.min(index.length, geometry.drawRange.count);
  let area = 0;
  for (let k = 0; k < count; k += 3) {
    const [a, b, c] = [index[k]! * 3, index[k + 1]! * 3, index[k + 2]! * 3];
    // Upward faces: the cross product's y is positive (wound counter-clockwise seen from above).
    const cross = (p[b + 2]! - p[a + 2]!) * (p[c]! - p[a]!) - (p[b]! - p[a]!) * (p[c + 2]! - p[a + 2]!);
    expect(cross).toBeGreaterThan(0);
    area += cross / 2;
  }
  return { triangles: count / 3, area };
}

function groundOn(height: (x: number, z: number) => number): TerrainGround {
  const ground = new TerrainGround(
    new TerrainGrid(2048, NEAR_GROUND_CELL_METERS, height),
    4096,
    (_x, _z, out) => out.set(0x4a7a3a),
    new MeshBasicMaterial(),
    new MeshBasicMaterial(),
  );
  ground.update(0, 0);
  return ground;
}

describe('TerrainGround', () => {
  const cells = NEAR_GROUND_METERS / NEAR_GROUND_CELL_METERS;

  it('draws hilly ground cell by cell, round the camera', () => {
    const ground = groundOn((x, z) => 20 + 10 * Math.sin(x / 90) * Math.cos(z / 70));
    const near = drawn(ground.near.geometry);
    expect(near.triangles).toBe(cells * cells * 2);
    expect(near.area).toBeCloseTo(NEAR_GROUND_METERS * NEAR_GROUND_METERS, 0);
  });

  it('draws flat ground in big quads, the slopes beside it still cell by cell, covering the same square', () => {
    // Flat to the west (a town), a slope rising to the east.
    const ground = groundOn((x) => (x > 200 ? (x - 200) * 0.1 : 0));
    const near = drawn(ground.near.geometry);
    expect(near.area).toBeCloseTo(NEAR_GROUND_METERS * NEAR_GROUND_METERS, 0);
    // The slope's third (x from 200 m to the square's edge at 512 m) at full detail, the rest at a sixteenth.
    expect(near.triangles).toBeLessThan(cells * cells * 2 * 0.4);
    expect(near.triangles).toBeGreaterThan(cells * cells * 2 * 0.3);
    const far = drawn(ground.far.geometry);
    expect(far.area).toBeGreaterThan(4096 * 4096 * 0.99);
    // Its colours are the tint's, lit evenly on the flat.
    const colors = ground.near.geometry.getAttribute('color');
    const flatColor = new Color().fromBufferAttribute(colors as never, 0);
    expect(flatColor.r).toBeGreaterThan(0);
    ground.dispose();
  });
});
