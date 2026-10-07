// Runs in the page before the game (scripts/perfRun.mjs): tells it a phone's GPU name, cores and memory, so it builds
// what it builds on that phone rather than its plainer world for software drawing; times each frame's work on the main
// thread and records long tasks; with `stubDraws` leaves the GPU's own drawing out (the CPU's part of each draw stays);
// and, unless `lean`, counts draw and uniform calls and (`trackGl`) what the GPU holds, at some cost to the timings.
(({ gpu, cores, memory, trackGl, stubDraws, lean }) => {
  Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => cores, configurable: true });
  Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => memory, configurable: true });
  const UNMASKED_RENDERER = 0x9246;
  for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    const getParameter = proto.getParameter;
    proto.getParameter = function (p) {
      return p === UNMASKED_RENDERER ? gpu : getParameter.call(this, p);
    };
  }
  const perf = { frames: [], stamps: [], long: [], links: 0, programs: 0 };
  window.__perf = perf;

  // Frame work: the main-thread time of every animation-frame callback of a frame, summed.
  const raf = window.requestAnimationFrame.bind(window);
  let lastStamp = -1;
  let work = 0;
  window.requestAnimationFrame = function (callback) {
    return raf(function (stamp) {
      const start = performance.now();
      callback(stamp);
      const spent = performance.now() - start;
      if (stamp !== lastStamp) {
        if (lastStamp >= 0) perf.frames.push(work);
        perf.stamps.push(stamp);
        lastStamp = stamp;
        work = 0;
      }
      work += spent;
    });
  };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) perf.long.push([entry.startTime, entry.duration]);
  }).observe({ type: 'longtask', buffered: true });

  const P = WebGL2RenderingContext.prototype;
  const wrapAfter = (name, after) => {
    const original = P[name];
    P[name] = function () {
      const result = original.apply(this, arguments);
      after.apply(this, arguments);
      return result;
    };
  };
  // The GPU's own work left out: what the CPU does for a frame stays (three.js culling, uniforms, state, uploads).
  perf.draws = 0;
  perf.uniforms = 0;
  for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) {
    const original = P[name];
    if (lean) {
      if (stubDraws) P[name] = function () {};
    } else {
      P[name] = stubDraws ? function () { perf.draws++; } : function (a, b, c, d, e) { perf.draws++; return original.call(this, a, b, c, d, e); };
    }
  }
  if (stubDraws) {
    for (const name of ['clear', 'blitFramebuffer']) P[name] = function () {};
  }
  for (const name of lean ? [] : Object.getOwnPropertyNames(P).filter((n) => /^uniform(\d|Matrix)/.test(n))) {
    const original = P[name];
    P[name] = function (a, b, c, d, e) { perf.uniforms++; return original.call(this, a, b, c, d, e); };
  }
  // Time spent waiting for shaders to compile and link (three.js asks for their status, which waits for them).
  perf.shaderWaitMs = 0;
  for (const name of ['getProgramParameter', 'getShaderParameter', 'getProgramInfoLog', 'getShaderInfoLog']) {
    const original = P[name];
    P[name] = function (a, b) {
      const start = performance.now();
      const result = original.call(this, a, b);
      perf.shaderWaitMs += performance.now() - start;
      return result;
    };
  }
  wrapAfter('createProgram', () => perf.programs++);
  wrapAfter('deleteProgram', () => perf.programs--);
  wrapAfter('linkProgram', () => perf.links++);
  if (!trackGl) {
    window.__perfSnapshot = () => ({ programs: perf.programs, links: perf.links, shaderWaitMs: Math.round(perf.shaderWaitMs) });
    return;
  }
  // Bytes per pixel: sized formats, then unsized format × type.
  const SIZED = { 0x8058: 4, 0x8c43: 4, 0x881a: 8, 0x8814: 16, 0x8051: 4, 0x881b: 8, 0x8229: 1, 0x822b: 2, 0x822d: 2, 0x822f: 4, 0x822e: 4, 0x8230: 8,
    0x88f0: 4, 0x81a6: 4, 0x81a5: 2, 0x8cac: 4, 0x8d48: 1, 0x8c3a: 4, 0x8059: 4, 0x8d62: 2, 0x8c41: 4, 0x8815: 12 };
  const BASE = { 0x1908: 4, 0x1907: 3, 0x1909: 1, 0x190a: 2, 0x1906: 1, 0x1903: 1, 0x8227: 2, 0x1902: 4, 0x84f9: 4 };
  const TYPE = { 0x1401: 1, 0x140b: 2, 0x8d61: 2, 0x1406: 4, 0x1403: 2, 0x1405: 4, 0x84fa: 1 };
  const bpp = (internal, format, type) => SIZED[internal] ?? (BASE[format] ?? BASE[internal] ?? 4) * (TYPE[type] ?? 1);
  let unit = 0x84c0;
  const boundTextures = new Map();
  const boundBuffers = new Map();
  let boundRenderbuffer = null;
  const textures = new Map();
  const buffers = new Map();
  const renderbuffers = new Map();
  const binding = (target) => (target >= 0x8515 && target <= 0x851a ? 0x8513 : target);
  const bound = (target) => boundTextures.get(unit * 65536 + binding(target));
  const setTexture = (texture, key, bytes) => {
    if (!texture) return;
    let levels = textures.get(texture);
    if (!levels) textures.set(texture, (levels = new Map()));
    levels.set(key, bytes);
  };
  const activeTexture = P.activeTexture;
  P.activeTexture = function (u) { unit = u; return activeTexture.call(this, u); };
  const bindTexture = P.bindTexture;
  P.bindTexture = function (t, x) { boundTextures.set(unit * 65536 + t, x); return bindTexture.call(this, t, x); };
  const bindBuffer = P.bindBuffer;
  P.bindBuffer = function (t, x) { boundBuffers.set(t, x); return bindBuffer.call(this, t, x); };
  const bindRenderbuffer = P.bindRenderbuffer;
  P.bindRenderbuffer = function (t, x) { boundRenderbuffer = x; return bindRenderbuffer.call(this, t, x); };
  wrapAfter('texImage2D', function (target, level, internal, a3, a4, a5, a6, a7) {
    let w, h, format, type;
    if (arguments.length >= 8) { w = a3; h = a4; format = a6; type = a7; }
    else { format = a3; type = a4; const s = a5; w = s?.videoWidth || s?.naturalWidth || s?.width || 0; h = s?.videoHeight || s?.naturalHeight || s?.height || 0; }
    setTexture(bound(target), target * 32 + level, w * h * bpp(internal, format, type));
  });
  wrapAfter('texImage3D', function (target, level, internal, w, h, d, border, format, type) {
    setTexture(bound(target), target * 32 + level, w * h * d * bpp(internal, format, type));
  });
  wrapAfter('texStorage2D', function (target, levels, internal, w, h) {
    let bytes = 0;
    for (let l = 0; l < levels; l++) bytes += Math.max(1, w >> l) * Math.max(1, h >> l) * (SIZED[internal] ?? 4);
    setTexture(bound(target), -1, bytes * (target === 0x8513 ? 6 : 1));
  });
  wrapAfter('texStorage3D', function (target, levels, internal, w, h, d) {
    let bytes = 0;
    for (let l = 0; l < levels; l++) bytes += Math.max(1, w >> l) * Math.max(1, h >> l) * d * (SIZED[internal] ?? 4);
    setTexture(bound(target), -1, bytes);
  });
  wrapAfter('deleteTexture', (texture) => textures.delete(texture));
  wrapAfter('bufferData', function (target, data) {
    const buffer = boundBuffers.get(target);
    if (buffer) buffers.set(buffer, typeof data === 'number' ? data : (data?.byteLength ?? 0));
  });
  wrapAfter('deleteBuffer', (buffer) => buffers.delete(buffer));
  wrapAfter('renderbufferStorage', function (target, internal, w, h) { renderbuffers.set(boundRenderbuffer, w * h * (SIZED[internal] ?? 4)); });
  wrapAfter('renderbufferStorageMultisample', function (target, samples, internal, w, h) {
    renderbuffers.set(boundRenderbuffer, w * h * (SIZED[internal] ?? 4) * Math.max(1, samples));
  });
  wrapAfter('deleteRenderbuffer', (rb) => renderbuffers.delete(rb));
  const total = (map) => { let sum = 0; for (const v of map.values()) sum += v instanceof Map ? total(v) : v; return sum; };
  window.__perfSnapshot = () => {
    const canvas = document.querySelector('canvas');
    return {
      programs: perf.programs, links: perf.links, shaderWaitMs: Math.round(perf.shaderWaitMs),
      textures: textures.size, textureBytes: total(textures),
      buffers: buffers.size, bufferBytes: total(buffers),
      renderbufferBytes: total(renderbuffers),
      canvas: canvas ? [canvas.width, canvas.height] : null,
    };
  };
})
