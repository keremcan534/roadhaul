// Injected into the game's page before it loads, for the trailer (scripts/trailer/shoot.mjs). Nothing in the game
// knows of it: it reaches three.js through the devtools hook three.js itself calls, and the game's sound through the
// AudioContext global the game builds its context from.
//
// - Frames: once __trailer.hold() is called, animation frames wait for __trailer.step(ms) instead of the display, so
//   the game runs frame by frame on the video's clock however long a 4K frame takes to draw and read back.
// - Camera: three dispatches 'observe' on window.__THREE_DEVTOOLS__ with each Scene and WebGLRenderer it makes. The
//   game's camera is the PerspectiveCamera the renderer first compiles or draws the main scene with. CameraRig ends
//   every frame with camera.lookAt(target), and nothing else calls it, so right after it a shot's pose replaces the
//   rig's: everything later in the frame (the lamps, the sky's centre, rain and plants round the eye, the sun's
//   glare, the colour pass) sees the shot's camera. Clearing the shot hands the camera back without a jump.
// - Resolution: the renderer's setDrawingBufferSize is wrapped so the drawing buffer is always at the pixel ratio
//   asked for, past the preset's cap and the adaptive resolution.
// - Motion blur: sub-frames are summed in a float buffer on the GPU, then averaged (and resampled, Lanczos-3) onto
//   an output canvas that sits right over the game's (under the HUD), to be read back raw or shown for screenshots.
// - Sound: AudioContext is an OfflineAudioContext behind a proxy whose clock is the video's; it reads as suspended
//   until __trailer.listen() (so the menus' clicks are not heard), and __trailer.sound(from, seconds) renders it.
(() => {
  // ---- The video's clock ----
  const requestFrame = window.requestAnimationFrame.bind(window);
  const cancelFrame = window.cancelAnimationFrame.bind(window);
  let held = false;
  let now = 0;
  let clockMs = 0;
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

  // ---- three.js ----
  const state = {
    scene: null,
    renderer: null,
    camera: null,
    truckRoot: null,
    pixelRatio: null,
    shot: null,
    params: null,
    shotStartMs: 0,
    out: { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, fov: 50, roll: 0 },
    /** The main scene was drawn since this was last cleared. */
    drawn: false,
    truck: { x: 0, z: 0, heading: 0, found: false },
  };
  const devtools = new EventTarget();
  window.__THREE_DEVTOOLS__ = devtools;
  devtools.addEventListener('observe', (event) => {
    const object = event.detail;
    if (object?.isScene && state.scene === null) {
      state.scene = object;
    } else if (object?.isWebGLRenderer && state.renderer === null) {
      patchRenderer(object);
    }
  });

  function patchRenderer(renderer) {
    state.renderer = renderer;
    const setDrawingBufferSize = renderer.setDrawingBufferSize;
    renderer.setDrawingBufferSize = function (width, height, pixelRatio) {
      return setDrawingBufferSize.call(this, width, height, state.pixelRatio ?? pixelRatio);
    };
    const adopt = (scene, camera) => {
      if (state.camera === null && scene === state.scene && camera?.isPerspectiveCamera) {
        adoptCamera(camera);
      }
    };
    for (const name of ['compile', 'render']) {
      const original = renderer[name];
      renderer[name] = function (scene, camera, target) {
        adopt(scene, camera);
        if (name === 'render' && scene === state.scene) {
          state.drawn = true;
        }
        return original.call(this, scene, camera, target);
      };
    }
  }

  function adoptCamera(camera) {
    state.camera = camera;
    const lookAt = camera.lookAt;
    camera.lookAt = function (x, y, z) {
      lookAt.call(this, x, y, z);
      if (state.shot !== null) {
        applyShot(this, lookAt);
      }
    };
  }

  function findTruck() {
    const root = state.truckRoot;
    if (root !== null && root.parent === state.scene) {
      return root;
    }
    let body = state.scene?.getObjectByName('truck-body') ?? null;
    while (body !== null && body.parent !== null && body.parent !== state.scene) {
      body = body.parent;
    }
    state.truckRoot = body;
    return body;
  }

  function applyShot(camera, lookAt) {
    const root = findTruck();
    const truck = state.truck;
    truck.found = root !== null;
    if (root !== null) {
      // The pose set for this frame (the world matrix is only updated at render time, a frame late).
      truck.x = root.position.x;
      truck.z = root.position.z;
      truck.heading = root.rotation.y;
    }
    const out = state.out;
    out.roll = 0;
    state.shot((clockMs - state.shotStartMs) / 1000, truck, out, state.params);
    camera.position.set(out.px, out.py, out.pz);
    camera.up.set(0, 1, 0);
    lookAt.call(camera, out.tx, out.ty, out.tz);
    if (out.roll !== 0) {
      camera.rotateZ(out.roll);
    }
    if (Math.abs(camera.fov - out.fov) > 1e-6) {
      camera.fov = out.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }

  // ---- Motion blur and resampling on the GPU ----
  const LANCZOS = `#version 300 es
precision highp float;
uniform sampler2D t; uniform vec2 srcSize; uniform vec2 dstSize; uniform float k; uniform float flip;
out vec4 o;
float L(float x) { x = abs(x); if (x < 1e-5) return 1.; if (x >= 3.) return 0.; float px = 3.14159265 * x; return 3. * sin(px) * sin(px / 3.) / (px * px); }
void main() {
  vec2 p = gl_FragCoord.xy;
  if (flip > .5) p.y = dstSize.y - p.y;
  vec2 s = max(srcSize / dstSize, vec2(1.));
  vec2 c = p * srcSize / dstSize;
  int rx = int(ceil(3. * s.x)); int ry = int(ceil(3. * s.y));
  ivec2 base = ivec2(floor(c));
  ivec2 hi = ivec2(srcSize) - 1;
  vec3 acc = vec3(0.); float wsum = 0.;
  for (int j = -ry; j <= ry; j++) {
    for (int i = -rx; i <= rx; i++) {
      ivec2 q = base + ivec2(i, j);
      vec2 d = (vec2(q) + .5 - c) / s;
      float w = L(d.x) * L(d.y);
      if (w != 0.) { acc += texelFetch(t, clamp(q, ivec2(0), hi), 0).rgb * w; wsum += w; }
    }
  }
  o = vec4(clamp(acc / wsum * k, 0., 1.), 1.);
}`;
  const accum = {
    canvas: null,
    gl: null,
    count: 0,
    srcW: 0,
    srcH: 0,
    sum: null,
    pixels: null,
    setup() {
      if (this.gl !== null) return;
      const canvas = document.createElement('canvas');
      canvas.id = 'trailer-frame';
      canvas.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;display:none;pointer-events:none';
      // Right over the game's canvas, under everything the game draws in the page (the HUD, the panels).
      state.renderer.domElement.after(canvas);
      const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: true });
      if (gl.getExtension('EXT_color_buffer_float') === null) throw new Error('No float render targets');
      const shader = (type, source) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, source);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        return sh;
      };
      const program = (fragment) => {
        const pr = gl.createProgram();
        gl.attachShader(pr, shader(gl.VERTEX_SHADER, '#version 300 es\nin vec2 p;out vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}'));
        gl.attachShader(pr, shader(gl.FRAGMENT_SHADER, fragment));
        gl.bindAttribLocation(pr, 0, 'p');
        gl.linkProgram(pr);
        if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
        return pr;
      };
      this.addProgram = program('#version 300 es\nprecision highp float;in vec2 uv;uniform sampler2D t;out vec4 o;void main(){o=vec4(texture(t,uv).rgb,1.);}');
      this.outProgram = program(LANCZOS);
      const quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.source = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.source);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      this.fbo = gl.createFramebuffer();
      this.canvas = canvas;
      this.gl = gl;
    },
    sized(width, height) {
      if (width === this.srcW && height === this.srcH) return;
      const gl = this.gl;
      if (this.sum !== null) gl.deleteTexture(this.sum);
      this.sum = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.sum);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sum, 0);
      this.srcW = width;
      this.srcH = height;
    },
    begin() {
      this.setup();
      const game = state.renderer.domElement;
      this.sized(game.width, game.height);
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, this.srcW, this.srcH);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.count = 0;
    },
    /** Adds the game's canvas as drawn in this task (its buffer is not preserved past it). */
    add() {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.source);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, state.renderer.domElement);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, this.srcW, this.srcH);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.addProgram);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
      this.count++;
    },
    /** The average, `width` x `height` device pixels: shown over the game (upright), or flipped for readPixels. */
    finish(width, height, show) {
      const gl = this.gl;
      const canvas = this.canvas;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.bindTexture(gl.TEXTURE_2D, this.sum);
      const pr = this.outProgram;
      gl.useProgram(pr);
      gl.uniform2f(gl.getUniformLocation(pr, 'srcSize'), this.srcW, this.srcH);
      gl.uniform2f(gl.getUniformLocation(pr, 'dstSize'), width, height);
      gl.uniform1f(gl.getUniformLocation(pr, 'k'), 1 / Math.max(1, this.count));
      gl.uniform1f(gl.getUniformLocation(pr, 'flip'), show ? 0 : 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      canvas.style.display = show ? 'block' : 'none';
    },
    read() {
      const gl = this.gl;
      const size = this.canvas.width * this.canvas.height * 4;
      if (this.pixels === null || this.pixels.length !== size) this.pixels = new Uint8Array(size);
      gl.readPixels(0, 0, this.canvas.width, this.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
      return this.pixels;
    },
  };

  // ---- Sound ----
  const SAMPLE_RATE = 48000;
  const sound = { context: null, listening: false, fromMs: 0, seconds: 0 };
  if (typeof OfflineAudioContext !== 'undefined') {
    window.AudioContext = function TrailerAudioContext() {
      if (sound.context !== null) {
        throw new Error('The trailer hook allows one audio context.');
      }
      const offline = new OfflineAudioContext(2, Math.ceil(SAMPLE_RATE * sound.seconds), SAMPLE_RATE);
      sound.context = offline;
      return new Proxy(offline, {
        get(target, key) {
          if (key === 'state') return sound.listening ? 'running' : 'suspended';
          if (key === 'currentTime') return sound.listening ? Math.max(0, (clockMs - sound.fromMs) / 1000) : 0;
          if (key === 'resume' || key === 'suspend' || key === 'close') return () => Promise.resolve();
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };
  }

  window.__trailer = {
    state,
    accum,
    /** From now on, frames come from step(). */
    hold() {
      held = true;
      now = performance.now();
    },
    /** Runs one frame, `ms` after the last; returns how many callbacks ran. */
    step(ms) {
      now += ms;
      clockMs += ms;
      const due = waiting;
      waiting = new Map();
      for (const callback of due.values()) {
        callback(now);
      }
      return due.size;
    },
    clockMs: () => clockMs,
    /**
     * Runs a frame `ms` after the last and makes sure the scene was drawn in it: behind the menus and panels the game
     * draws every other frame, so a frame that did not draw is followed at once by one that does.
     */
    drawStep(ms) {
      state.drawn = false;
      this.step(ms);
      for (let extra = 0; extra < 3 && !state.drawn; extra++) {
        this.step(0);
      }
      return state.drawn;
    },
    /** The drawing buffer's pixel ratio from the next resize on (null: the game's own). */
    setPixelRatio(ratio) {
      state.pixelRatio = ratio;
    },
    /** `source`: '(t, truck, out, p) => …' filling out {px,py,pz,tx,ty,tz,fov,roll}; t from now, in game seconds. */
    setShot(source, params, startDelayMs = 0) {
      state.shot = source === null ? null : new Function(`return (${source});`)();
      state.params = params ?? {};
      state.shotStartMs = clockMs + startDelayMs;
    },
    truck() {
      const root = findTruck();
      return root === null ? null : { x: root.position.x, z: root.position.z, heading: root.rotation.y };
    },
    /** Before the game makes its audio context (the first click): how long the sound may run, in seconds. */
    soundLength(seconds) {
      sound.seconds = seconds;
    },
    /** The game's sound starts now, on the video's clock (its time 0). */
    listen() {
      sound.listening = true;
      sound.fromMs = clockMs;
    },
    /** Seconds since listen(). */
    heard: () => (clockMs - sound.fromMs) / 1000,
    /** Renders the sound and returns `seconds` of it from `from` (seconds since listen()), as 16-bit stereo, base64. */
    async sound(from, seconds) {
      if (sound.context === null) return null;
      const buffer = await sound.context.startRendering();
      const first = Math.round(from * SAMPLE_RATE);
      const length = Math.round(seconds * SAMPLE_RATE);
      const pcm = new Int16Array(length * 2);
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      for (let i = 0; i < length; i++) {
        const at = first + i;
        const l = at < left.length ? left[at] : 0;
        const r = at < right.length ? right[at] : 0;
        pcm[i * 2] = Math.max(-32768, Math.min(32767, Math.round(l * 32767)));
        pcm[i * 2 + 1] = Math.max(-32768, Math.min(32767, Math.round(r * 32767)));
      }
      const bytes = new Uint8Array(pcm.buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      return btoa(binary);
    },
    info() {
      const r = state.renderer;
      return {
        haveScene: state.scene !== null,
        haveCamera: state.camera !== null,
        truck: findTruck() !== null,
        buffer: r ? { w: r.domElement.width, h: r.domElement.height } : null,
        sound: sound.context !== null,
      };
    },
  };
})();
