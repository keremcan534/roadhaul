import type { Object3D } from 'three';

/**
 * The pieces RenderHost.precompileGradually() compiles one at a time: the objects that
 * draw, each with whatever hangs under it, found by going down through the
 * groups that only hold others. Hidden ones too.
 */
export function compilePieces(root: Object3D): Object3D[] {
  const pieces: Object3D[] = [];
  const visit = (parent: Object3D): void => {
    for (const child of parent.children) {
      if ('material' in child) {
        pieces.push(child);
      } else {
        visit(child);
      }
    }
  };
  visit(root);
  return pieces;
}
