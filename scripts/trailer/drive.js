// Injected after hook.js, for the trailer: an autopilot. The game has none, and a truck with the throttle held leaves
// the road at the first bend. It follows a lane's centre (a polyline) at a target speed by pressing the game's own
// keys (keyboard events on window, which the game's KeyboardInput listens to): pure pursuit, with a model of the
// truck's steering ramp choosing each frame the key (left, none, right) that brings the wheel nearest where it should
// be. It can stop at a point (a depot's bay) and coast (no throttle: no dark puffs from the exhaust under load).
(() => {
  const keys = { ArrowLeft: false, ArrowRight: false, ArrowUp: false, ArrowDown: false };
  function setKey(code, down) {
    if (keys[code] === down) return;
    keys[code] = down;
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true }));
  }
  const smoothstep = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const approach = (value, target, delta) => (value < target ? Math.min(target, value + delta) : Math.max(target, value - delta));

  const drive = {
    path: null,
    targetKmh: 0,
    handling: null,
    /** The modelled steering position, -1 (left) .. 1 (right). */
    s: 0,
    /** The truck's speed, m/s, measured. */
    v: 0,
    idx: 0,
    last: null,
    lastDt: 0,
    on: false,
    coast: false,
    /** Off the path, metres (+ left), at the last decision. */
    cross: 0,
    stopAt: null,
    gain: 1,
    decel: 1.2,
    /** Follows `path` ({x: [], z: []}) at `targetKmh`; options: stopAt (metres along it), decel (m/s²), gain. */
    set(path, targetKmh, handling, options = {}) {
      const along = [0];
      for (let i = 1; i < path.x.length; i++) {
        along.push(along[i - 1] + Math.hypot(path.x[i] - path.x[i - 1], path.z[i] - path.z[i - 1]));
      }
      this.path = { x: path.x, z: path.z, along };
      this.targetKmh = targetKmh;
      this.handling = handling;
      this.idx = 0;
      this.on = true;
      this.stopAt = options.stopAt ?? null;
      this.gain = options.gain ?? 1;
      this.decel = options.decel ?? 1.2;
    },
    /** Metres along the path the truck has come. */
    progress() {
      return this.path === null ? 0 : this.path.along[this.idx];
    },
    off() {
      this.on = false;
      for (const code of Object.keys(keys)) setKey(code, false);
    },
    nearest(x, z) {
      const p = this.path;
      let best = this.idx;
      let bestD = Infinity;
      for (let i = Math.max(0, this.idx - 5); i <= Math.min(p.x.length - 1, this.idx + 60); i++) {
        const d = (p.x[i] - x) ** 2 + (p.z[i] - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      this.idx = best;
      return best;
    },
    pointAt(distance) {
      const p = this.path;
      const last = p.x.length - 1;
      if (distance >= p.along[last]) {
        // Past the end: on, straight.
        const dx = p.x[last] - p.x[last - 1];
        const dz = p.z[last] - p.z[last - 1];
        const n = Math.hypot(dx, dz) || 1;
        const extra = distance - p.along[last];
        return [p.x[last] + (dx / n) * extra, p.z[last] + (dz / n) * extra];
      }
      let i = this.idx;
      while (i < last && p.along[i + 1] < distance) i++;
      const span = p.along[i + 1] - p.along[i] || 1;
      const t = Math.max(0, Math.min(1, (distance - p.along[i]) / span));
      return [p.x[i] + (p.x[i + 1] - p.x[i]) * t, p.z[i] + (p.z[i + 1] - p.z[i]) * t];
    },
    /** One decision for the next `dt` seconds of game time. */
    tick(dt) {
      if (!this.on || this.path === null || dt <= 0) return;
      const truck = window.__trailer.truck();
      if (truck === null) return;
      if (this.last !== null && this.lastDt > 0) {
        this.v = Math.hypot(truck.x - this.last.x, truck.z - this.last.z) / this.lastDt;
      }
      this.last = { x: truck.x, z: truck.z };
      this.lastDt = dt;
      const h = truck.heading;
      const fx = Math.sin(h);
      const fz = Math.cos(h);
      const lx = Math.cos(h);
      const lz = -Math.sin(h);
      // Steer from the truck's middle (its root is at the rear axle).
      const wheelbase = this.handling.wheelbase;
      const cx = truck.x + fx * wheelbase * 0.5;
      const cz = truck.z + fz * wheelbase * 0.5;
      const i = this.nearest(cx, cz);
      const p = this.path;
      this.cross = (cx - p.x[i]) * lx + (cz - p.z[i]) * lz;
      const v = this.v;
      const [tx, tz] = this.pointAt(p.along[i] + Math.max(7, Math.min(35, v * 1.1)));
      const dx = tx - cx;
      const dz = tz - cz;
      const alpha = Math.atan2(dx * lx + dz * lz, dx * fx + dz * fz);
      const k = (2 * Math.sin(alpha)) / Math.hypot(dx, dz);
      const maxSteer = (this.handling.maxSteerDeg * Math.PI) / 180;
      const kmax = Math.min(Math.tan(maxSteer) / wheelbase, (this.handling.latG * 9.81 * 1.15) / Math.max(1, v * v));
      const wanted = Math.max(-1, Math.min(1, (-k / kmax) * this.gain));
      const pace = (this.handling.steerSpeedDeg / this.handling.maxSteerDeg) * (1 - 0.4 * smoothstep(5, 22, Math.abs(v)));
      let bestKey = 0;
      let bestError = Infinity;
      let bestS = this.s;
      for (const key of [-1, 0, 1]) {
        const returning = Math.abs(key) < Math.abs(this.s) || key * this.s < 0;
        const next = approach(this.s, key, (returning ? pace * 1.6 : pace) * dt);
        const error = Math.abs(next - wanted) + (key === 0 ? 0 : 0.002);
        if (error < bestError) {
          bestError = error;
          bestKey = key;
          bestS = next;
        }
      }
      this.s = bestS;
      setKey('ArrowRight', bestKey > 0);
      setKey('ArrowLeft', bestKey < 0);
      let target = this.targetKmh / 3.6;
      if (this.stopAt !== null) {
        const left = this.stopAt - p.along[i];
        target = Math.min(target, Math.sqrt(Math.max(0, 2 * this.decel * Math.max(0, left - 0.5))));
        if (left < 0.6) target = 0;
      }
      const brake = v > target + (target < 0.5 ? 0.05 : 1.2);
      setKey('ArrowUp', !this.coast && !brake && v < target - 0.3);
      // Braking at a standstill would reverse: only while it still rolls.
      setKey('ArrowDown', brake && v > 0.3);
    },
  };
  window.__drive = drive;

  // Every frame of the game (each __trailer.step) is decided first, for the game time it will simulate (the game
  // caps a frame at a twelfth of a second).
  const trailer = window.__trailer;
  const step = trailer.step.bind(trailer);
  trailer.step = (ms) => {
    drive.tick(Math.min(ms, 1000 / 12) / 1000);
    return step(ms);
  };
})();
