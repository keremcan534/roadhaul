import type { VehicleBody } from '../../data/definitions/VehicleDefinition';

/**
 * Where the cab's parts are, in the truck's own frame: x to the truck's
 * left, y up, z forward from the rear axle. The truck model (TruckView)
 * and the cameras (CameraRig) share it, so the driver's eye sits behind the
 * steering wheel and the hood camera on the cab's roof.
 */
export interface CabGeometry {
  /** The front and back faces of the whole body. */
  readonly frontZ: number;
  readonly rearZ: number;
  /** The middle of the body, ahead of the rear axle. */
  readonly centreZ: number;
  /** Top of the cab's windows (the cab roof), and the window line. */
  readonly cabTop: number;
  readonly beltY: number;
  /** The cab-over's floor height: the box floor clears the wheels. */
  readonly deckY: number;
  readonly cabLength: number;
  /** The driver's eye: left seat (the map drives on the right), a meter behind the windscreen, over the wheel. */
  readonly eyeX: number;
  readonly eyeY: number;
  readonly eyeZ: number;
  /** The left side mirror's glass (the right one mirrors it across x = 0): its middle, facing back, and its size. */
  readonly mirror: { readonly x: number; readonly y: number; readonly z: number; readonly width: number; readonly height: number };
}

export function cabGeometry(body: VehicleBody): CabGeometry {
  const { lengthMeters: L, widthMeters: W, heightMeters: H, wheelbaseMeters: B, wheelRadiusMeters: R } = body;
  const centreZ = B / 2;
  const frontZ = centreZ + L / 2;
  const deckY = 2 * R + 0.1;
  const cabTop = deckY + (H - deckY) * 0.78;
  const beltY = deckY + (cabTop - deckY) * 0.42;
  return {
    frontZ,
    rearZ: centreZ - L / 2,
    centreZ,
    cabTop,
    beltY,
    deckY,
    cabLength: Math.min(2.4, Math.max(1.8, L * 0.28)),
    eyeX: W * 0.22,
    eyeY: H * 0.72,
    eyeZ: frontZ - 1.05,
    mirror: { x: W / 2 + 0.33, y: beltY + (cabTop - beltY) * 0.3, z: frontZ - 0.356, width: 0.16, height: 0.31 },
  };
}
