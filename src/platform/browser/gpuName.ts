/**
 * The GPU's name, from a WebGL context made only to ask and let go at once,
 * before the game's own is made (the preset decides how that one is set up).
 * Undefined where there is no WebGL.
 */
export function gpuName(document: Document): string | undefined {
  const gl = document.createElement('canvas').getContext('webgl');
  if (gl === null) {
    return undefined;
  }
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(gl.getParameter(info === null ? gl.RENDERER : info.UNMASKED_RENDERER_WEBGL));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return name;
}
