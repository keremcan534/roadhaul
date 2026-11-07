// The trailer's camera moves: functions the page runs every frame (hook.js setShot), given the shot's time t (game
// seconds since the shot began), the truck's pose {x, z, heading} (heading 0 along +z, forward (sin h, cos h), right
// (-cos h, sin h)), the output {px, py, pz, tx, ty, tz, fov, roll} and the shot's parameters p. They are sources, not
// functions: they run in the page. A move goes from keyframe p.a to p.b over p.seconds, eased as p.ease says
// ('linear', 'out', or in and out). Keys starting with '_' are the move's own state.

/** Shared: the eased share of the move, and the truck's heading followed smoothly (p.lag: 1/seconds, default 3.6). */
const PRELUDE = `
  const s0 = Math.min(1, Math.max(0, t / p.seconds));
  const s = p.ease === 'linear' ? s0 : p.ease === 'out' ? 1 - (1 - s0) * (1 - s0) : s0 * s0 * (3 - 2 * s0);
  const b = p.b ?? p.a;
  const follow = () => {
    if (p._h === undefined || t < p._t) { p._h = truck.heading; }
    else { const d = Math.atan2(Math.sin(truck.heading - p._h), Math.cos(truck.heading - p._h)); p._h += d * Math.min(1, (t - p._t) * (p.lag ?? 3.6)); }
    p._t = t;
    return p._h;
  };`;

/**
 * RIG: the camera rides with the truck. Keyframe fields: ahead, side (+ right), height of the eye; lookAhead,
 * lookSide, lookHeight of the aim; fov, roll.
 */
export const RIG = `(t, truck, out, p) => {${PRELUDE}
  const h = follow(), fx = Math.sin(h), fz = Math.cos(h), rx = -fz, rz = fx;
  const L = (k) => { const a0 = p.a[k] ?? 0; const b0 = b[k] ?? a0; return a0 + (b0 - a0) * s; };
  out.px = truck.x + fx * L('ahead') + rx * L('side');
  out.pz = truck.z + fz * L('ahead') + rz * L('side');
  out.py = L('height');
  out.tx = truck.x + fx * L('lookAhead') + rx * L('lookSide');
  out.tz = truck.z + fz * L('lookAhead') + rz * L('lookSide');
  out.ty = L('lookHeight');
  out.fov = L('fov');
  out.roll = L('roll');
}`;

/**
 * WORLD: the eye moves between two fixed points (a.cam to b.cam, [x, y, z]) and aims at the truck (p.lookTruck:
 * {lookAhead, lookSide, lookHeight}) or between two fixed points (a.look to b.look); fov a.fov to b.fov.
 */
export const WORLD = `(t, truck, out, p) => {${PRELUDE}
  const lerp = (u, v) => u + (v - u) * s;
  out.px = lerp(p.a.cam[0], b.cam[0]); out.py = lerp(p.a.cam[1], b.cam[1]); out.pz = lerp(p.a.cam[2], b.cam[2]);
  if (p.lookTruck) {
    const h = follow(), fx = Math.sin(h), fz = Math.cos(h), l = p.lookTruck;
    out.tx = truck.x + fx * (l.lookAhead ?? 0) - fz * (l.lookSide ?? 0);
    out.tz = truck.z + fz * (l.lookAhead ?? 0) + fx * (l.lookSide ?? 0);
    out.ty = l.lookHeight ?? 1.5;
  } else {
    out.tx = lerp(p.a.look[0], b.look[0]); out.ty = lerp(p.a.look[1], b.look[1]); out.tz = lerp(p.a.look[2], b.look[2]);
  }
  out.fov = lerp(p.a.fov, b.fov ?? p.a.fov);
  out.roll = 0;
}`;

/** A RIG move's parameters: `seconds` long, from keyframe `a` to `b`. */
export const rig = (seconds, a, b, extra = {}) => ({ source: RIG, params: { seconds, a, b, ...extra } });
/** A WORLD move's parameters. */
export const fixed = (params) => ({ source: WORLD, params });
