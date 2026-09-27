import { Box3, Mesh, MeshLambertMaterial, Scene, Vector3, type BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { DIRECTION_BOARD_WIDTH_METERS, type DirectionBoard, type DirectionRow } from '../../../../src/domain/world/roadSigns';
import { SIGN_BOARD_ROW_PIXELS } from '../../../../src/presentation/textures/signBoardImages';
import { SignBoardView, boardHeight } from '../../../../src/presentation/world/SignBoardView';
import { drawCallCount, gpuResources, watchDisposal } from '../../../support/threeResources';

const row = (placeId: string, arrow: DirectionRow['arrow'], kilometers: number, placeKind: DirectionRow['placeKind'] = 'city'): DirectionRow => ({
  placeKind,
  placeId,
  arrow,
  kilometers,
});

/** A blue board facing west beside a road along x, a green one facing north, a blue one out of a town. */
const BOARDS: readonly DirectionBoard[] = [
  { x: -120, z: 7.4, heading: -Math.PI / 2, tone: 'blue', rows: [row('city_a', 'ahead', 12), row('hamlet', 'left', 3, 'village')] },
  { x: 40, z: -200, heading: 0, tone: 'green', rows: [row('city_b', 'ahead', 5)] },
  { x: 300, z: -7.4, heading: Math.PI / 2, tone: 'blue', rows: [row('city_a', null, 7), row('city_b', null, 9), row('hamlet', null, 2, 'village')] },
];
const NAMES: Readonly<Record<string, string>> = { city_a: 'Havenport', city_b: 'Ironford', hamlet: 'Reedmill' };
const nameOf = (entry: DirectionRow): string => NAMES[entry.placeId]!;

function mesh(scene: Scene, name: string): Mesh {
  let found: Mesh | undefined;
  scene.traverse((object) => {
    if (object instanceof Mesh && object.name === name) found = object;
  });
  return found!;
}

describe('SignBoardView', () => {
  it('draws every board in two draw calls, its faces laid out of one small sheet', () => {
    const scene = new Scene();
    new SignBoardView(scene, BOARDS, nameOf);

    expect(drawCallCount(scene)).toBe(2);
    const texture = (mesh(scene, 'sign-boards:faces').material as MeshLambertMaterial).map!;
    // Blue: its arrows and digits, then its three names two to a row; green: its row, then its one name.
    expect((texture.image as { height: number }).height).toBe(SIGN_BOARD_ROW_PIXELS * (1 + 2 + 1 + 1));
  });

  it('stands a board beside its road at its place, turned the way it faces, as tall as its rows', () => {
    const scene = new Scene();
    new SignBoardView(scene, BOARDS.slice(0, 1), nameOf);
    const faces = mesh(scene, 'sign-boards:faces').geometry;
    const box = new Box3().setFromBufferAttribute(faces.getAttribute('position') as BufferAttribute);
    const [board] = BOARDS;

    // Facing west (-x): a plane across x, spanning z the board's width, just west of its back.
    expect(box.max.x - box.min.x).toBeLessThan(0.001);
    expect(box.min.x).toBeLessThan(board!.x);
    expect(box.max.z - box.min.z).toBeCloseTo(DIRECTION_BOARD_WIDTH_METERS, 6);
    expect(box.getCenter(new Vector3()).z).toBeCloseTo(board!.z, 6);
    expect(box.max.y - box.min.y).toBeCloseTo(boardHeight(2), 6);
    expect(box.min.y).toBeGreaterThan(1.2);
    expect(faces.getAttribute('normal').getX(0)).toBeCloseTo(-1, 6);
  });

  it('tiles each face with its pieces, none over another', () => {
    const scene = new Scene();
    new SignBoardView(scene, BOARDS.slice(1, 2), nameOf);
    const faces = mesh(scene, 'sign-boards:faces').geometry;
    const position = faces.getAttribute('position');
    const index = faces.getIndex()!;
    // Facing +z: the quads lie in x and y; their areas add up to the board's.
    let area = 0;
    for (let i = 0; i < index.count; i += 3) {
      const [a, b, c] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      const abx = position.getX(b) - position.getX(a);
      const aby = position.getY(b) - position.getY(a);
      const acx = position.getX(c) - position.getX(a);
      const acy = position.getY(c) - position.getY(a);
      area += Math.abs(abx * acy - aby * acx) / 2;
    }
    expect(area).toBeCloseTo(DIRECTION_BOARD_WIDTH_METERS * boardHeight(1), 4);
  });

  it('shows a row\'s distance in its two digits, the first blank below ten kilometres', () => {
    const scene = new Scene();
    new SignBoardView(scene, [BOARDS[0]!], nameOf);
    const faces = mesh(scene, 'sign-boards:faces').geometry;
    const uv = faces.getAttribute('uv');
    const texture = (mesh(scene, 'sign-boards:faces').material as MeshLambertMaterial).map!;
    const { width } = texture.image as { width: number };
    // Each quad's left edge on the sheet, in pixels: the rim and pads (6 quads), then 7 pieces a row.
    const left = (quad: number): number => Math.round(uv.getX(quad * 4) * width - 0.5);
    const firstRow = [6, 7, 8, 9, 10, 11, 12].map(left);
    const secondRow = [13, 14, 15, 16, 17, 18, 19].map(left);
    // 12 km: the digits 1 and 2; 3 km: a blank (the board's colour), then 3.
    const digit = (value: number): number => 3 * SIGN_BOARD_ROW_PIXELS + value * 28;
    expect(firstRow.slice(4, 6)).toEqual([digit(1), digit(2)]);
    expect(secondRow[5]).toBe(digit(3));
    expect(secondRow[4]).not.toBe(digit(0));
    // Ahead, then left: the arrows' cells in turn.
    expect(firstRow[1]).toBe(SIGN_BOARD_ROW_PIXELS);
    expect(secondRow[1]).toBe(0);
  });

  it('lights the faces at night, as if in the headlights', () => {
    const scene = new Scene();
    const view = new SignBoardView(scene, BOARDS, nameOf);
    const material = mesh(scene, 'sign-boards:faces').material as MeshLambertMaterial;

    const byDay = material.emissiveIntensity;
    view.setLamps(1);
    expect(material.emissiveIntensity).toBeGreaterThan(byDay + 0.2);
    view.setLamps(0);
    expect(material.emissiveIntensity).toBe(byDay);
  });

  it('draws nothing on a map without boards', () => {
    const scene = new Scene();
    new SignBoardView(scene, [], nameOf).setLamps(1);

    expect(drawCallCount(scene)).toBe(0);
  });

  it('releases every GPU resource on dispose', () => {
    const scene = new Scene();
    const view = new SignBoardView(scene, BOARDS, nameOf);
    const resources = gpuResources(scene);
    const disposed = watchDisposal(resources);

    view.dispose();

    expect([...resources].filter((resource) => !disposed.has(resource))).toEqual([]);
    expect(scene.children).toEqual([]);
  });
});
