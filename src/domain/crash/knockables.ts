import type { DebrisShape } from './DebrisSimulation';

/**
 * The things standing about that give way to a truck driven into them hard
 * enough, instead of stopping it: a bin, a bench or a sign goes flying, a
 * hay bale or a bus shelter tumbles off, a lamp post snaps at its foot and
 * falls. Trees, walls, posts that carry wires, boulders and animals stay
 * solid.
 */
export const KNOCKABLE_KINDS = ['lamp', 'hayBale', 'bench', 'bin', 'busStop', 'speedSign', 'roadSign', 'mailbox'] as const;
export type KnockableKind = (typeof KNOCKABLE_KINDS)[number];

export interface Knockable {
  /** Driven into at least this fast (m/s) it gives way; slower, it stands like anything solid. */
  readonly knockSpeed: number;
  /** Its shape as debris: half extents about its middle, its height along y, its front toward +z. */
  readonly shape: DebrisShape;
  /** Its middle's way forward (+z) of its foot, meters: a lamp's arm reaches out over the road. */
  readonly centreZ: number;
  /** It flies off with this share of the speed the truck drove into it (before the config's throw factor). */
  readonly throwShare: number;
  /** And up at this share of that. */
  readonly popShare: number;
  /** It topples away from the truck at this many rad/s per m/s the truck drove into it… */
  readonly topple: number;
  /** …and tumbles every which way at up to this many. */
  readonly tumble: number;
  /** The truck takes this share of the speed it drove in as a crash (damage to it and its cargo): 0 for a bin. */
  readonly damageShare: number;
}

export const KNOCKABLES: Readonly<Record<KnockableKind, Knockable>> = {
  // A steel post 7.6 m tall with its arm and head: it snaps and falls, the arm lying flat.
  lamp: {
    knockSpeed: 5,
    shape: { halfX: 0.2, halfY: 3.8, halfZ: 1.2, massKg: 140, restitution: 0.15, friction: 0.5 },
    centreZ: 1,
    throwShare: 0.35,
    popShare: 0.15,
    topple: 0.12,
    tumble: 0.02,
    damageShare: 0.3,
  },
  // A round bale on its side (its axis along z), 300 kg of straw: it tumbles off the road.
  hayBale: {
    knockSpeed: 3,
    shape: { halfX: 0.75, halfY: 0.75, halfZ: 0.65, massKg: 300, restitution: 0.2, friction: 0.7 },
    centreZ: 0,
    throwShare: 0.9,
    popShare: 0.3,
    topple: 0.2,
    tumble: 0.15,
    damageShare: 0.2,
  },
  bench: {
    knockSpeed: 2.5,
    shape: { halfX: 0.8, halfY: 0.45, halfZ: 0.27, massKg: 45, restitution: 0.3, friction: 0.6 },
    centreZ: -0.05,
    throwShare: 1,
    popShare: 0.35,
    topple: 0.3,
    tumble: 0.3,
    damageShare: 0.1,
  },
  bin: {
    knockSpeed: 1.5,
    shape: { halfX: 0.26, halfY: 0.46, halfZ: 0.26, massKg: 15, restitution: 0.35, friction: 0.55 },
    centreZ: 0,
    throwShare: 1.2,
    popShare: 0.4,
    topple: 0.4,
    tumble: 0.5,
    damageShare: 0,
  },
  // Its posts, roof and panes, the bench inside and the sign on its pole: it goes over in one piece.
  busStop: {
    knockSpeed: 4,
    shape: { halfX: 1.85, halfY: 1.3, halfZ: 0.85, massKg: 260, restitution: 0.2, friction: 0.6 },
    centreZ: 0,
    throwShare: 0.6,
    popShare: 0.25,
    topple: 0.08,
    tumble: 0.05,
    damageShare: 0.3,
  },
  speedSign: {
    knockSpeed: 2,
    shape: { halfX: 0.4, halfY: 1.3, halfZ: 0.05, massKg: 14, restitution: 0.3, friction: 0.5 },
    centreZ: 0,
    throwShare: 1,
    popShare: 0.3,
    topple: 0.3,
    tumble: 0.4,
    damageShare: 0.05,
  },
  // A warning triangle, give way, stop or chevron board on its post, as light as a speed limit.
  roadSign: {
    knockSpeed: 2,
    shape: { halfX: 0.45, halfY: 1.3, halfZ: 0.05, massKg: 14, restitution: 0.3, friction: 0.5 },
    centreZ: 0,
    throwShare: 1,
    popShare: 0.3,
    topple: 0.3,
    tumble: 0.4,
    damageShare: 0.05,
  },
  // A farm's mailbox on its wooden post: it goes flying like a bin.
  mailbox: {
    knockSpeed: 1.5,
    shape: { halfX: 0.2, halfY: 0.62, halfZ: 0.25, massKg: 12, restitution: 0.35, friction: 0.55 },
    centreZ: 0,
    throwShare: 1.1,
    popShare: 0.4,
    topple: 0.35,
    tumble: 0.5,
    damageShare: 0,
  },
};

/** The kind a circle's code in `DrivingWorld.circleKind` stands for: 0 is solid, i + 1 is KNOCKABLE_KINDS[i]. */
export function knockableKindOf(code: number): KnockableKind | null {
  return code > 0 ? (KNOCKABLE_KINDS[code - 1] ?? null) : null;
}

/** The code for `kind` in `DrivingWorld.circleKind`, and a knocked-over thing's kind among debris. */
export function knockableCode(kind: KnockableKind): number {
  return KNOCKABLE_KINDS.indexOf(kind) + 1;
}
