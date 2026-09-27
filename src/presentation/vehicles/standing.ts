import type { Vector3 } from 'three';
import type { BodyPose } from '../../systems/driving/DrivingService';

/** A truck standing level on its wheels. */
export const LEVEL: Readonly<BodyPose> = Object.freeze({ bank: 0, tilt: 0, rise: 0, lean: 0, dip: 0 });

/**
 * Where the point (x left, y up, z ahead: the truck's model, its origin the
 * rear axle on the ground) is as the truck stands (`body`): turned about
 * its centre of mass (`cogHeight` up, `cogAhead` ahead of the rear axle) by
 * its roll, then its pitch, off its wheels (three.js' XYZ order: what the
 * truck's chassis turns by), and raised as it rises. Still in the truck's
 * frame; its lean and pitch on the springs are left out. Writes into `out`.
 */
export function standingPoint(
  out: Vector3,
  body: Readonly<BodyPose>,
  cogHeight: number,
  cogAhead: number,
  x: number,
  y: number,
  z: number,
): Vector3 {
  const up = y - cogHeight;
  const ahead = z - cogAhead;
  // Rolled (the left side up for a positive bank)…
  const bankCos = Math.cos(body.bank);
  const bankSin = Math.sin(body.bank);
  const across = x * bankCos - up * bankSin;
  const high = x * bankSin + up * bankCos;
  // …then pitched (the nose down for a positive tilt).
  const tiltCos = Math.cos(body.tilt);
  const tiltSin = Math.sin(body.tilt);
  return out.set(across, high * tiltCos - ahead * tiltSin + cogHeight + body.rise, high * tiltSin + ahead * tiltCos + cogAhead);
}
