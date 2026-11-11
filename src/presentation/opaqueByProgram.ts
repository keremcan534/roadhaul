import type { Material, WebGLProperties } from 'three';
import type { RenderItem } from 'three/src/renderers/webgl/WebGLRenderLists.js';

/**
 * The order the opaque things are drawn in: three.js's own (its group, its
 * render order, its material, near to far), but by shader program before
 * material. Its own interleaves the programs as materials were made, about
 * 49 programs a frame switched 70 times, each switch sending the camera's
 * and the lights' uniforms again; grouped, each program is switched to once.
 * The picture is the same: the opaque world is drawn against the depth
 * buffer, and what lies on something else is lifted by a polygon offset or
 * put in place by its render order, never by when it is drawn.
 */
export function opaqueByProgram(properties: WebGLProperties): (a: RenderItem, b: RenderItem) => number {
  const programOf = (material: Material): number =>
    (properties.get(material) as { currentProgram?: { id: number } }).currentProgram?.id ?? 0;
  // Every material has its number (three.js gives it one as it is made); the typings leave it out.
  const idOf = (material: Material): number => (material as unknown as { readonly id: number }).id;
  return (a, b) =>
    a.groupOrder - b.groupOrder ||
    a.renderOrder - b.renderOrder ||
    programOf(a.material) - programOf(b.material) ||
    idOf(a.material) - idOf(b.material) ||
    a.materialVariant - b.materialVariant ||
    a.z - b.z ||
    a.id - b.id;
}
