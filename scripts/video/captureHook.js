// Injected into the game's page before it loads, for the store video (scripts/video/shoot.mjs). Nothing in the game
// knows of it.
//
// - The GPU's name reads as hardware: headless Chromium draws in software (SwiftShader), where the game would draw
//   plainer to keep its frame rate (RenderHost.softwareRendering). The video shows the game as a phone's GPU draws it
//   on the high preset: the shadows, the colour pass, the mist and the lamps.
// - Once __video.hold() is called, animation frames wait for __video.step(ms) instead of the display: the game runs
//   frame by frame on the video's clock, however long a frame takes to draw in software.
(() => {
  const UNMASKED_RENDERER_WEBGL = 0x9246;
  for (const context of [WebGLRenderingContext, WebGL2RenderingContext]) {
    const getParameter = context.prototype.getParameter;
    context.prototype.getParameter = function (name) {
      return name === UNMASKED_RENDERER_WEBGL ? 'Video capture GPU' : getParameter.call(this, name);
    };
  }
  const requestFrame = window.requestAnimationFrame.bind(window);
  const cancelFrame = window.cancelAnimationFrame.bind(window);
  let held = false;
  let now = 0;
  let nextHandle = 1e9;
  let waiting = new Map();
  window.requestAnimationFrame = (callback) => {
    if (!held) {
      return requestFrame(callback);
    }
    const handle = nextHandle++;
    waiting.set(handle, callback);
    return handle;
  };
  window.cancelAnimationFrame = (handle) => {
    if (!waiting.delete(handle)) {
      cancelFrame(handle);
    }
  };
  window.__video = {
    /** From now on, frames come from step(). */
    hold() {
      held = true;
      now = performance.now();
    },
    /** Runs one frame, `ms` after the last one. */
    step(ms) {
      now += ms;
      const due = waiting;
      waiting = new Map();
      for (const callback of due.values()) {
        callback(now);
      }
      return due.size;
    },
  };
})();
