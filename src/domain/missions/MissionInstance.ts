import { frozenCopy } from '../../core/objects/frozenCopy';
import type { Fraction } from '../../data/units';

/**
 * Stages of an accepted contract (spec §50). "Available" is not a state: an
 * available mission is a MissionDefinition on the job board, and accepting it
 * creates the instance.
 */
export const MISSION_STATES = ['accepted', 'travellingToPickup', 'loaded', 'delivering', 'completed', 'failed'] as const;
export type MissionState = (typeof MISSION_STATES)[number];

/** Allowed transitions. Anything not listed is a bug. */
export const MISSION_STATE_TRANSITIONS = frozenCopy<Readonly<Record<MissionState, readonly MissionState[]>>>({
  accepted: ['travellingToPickup', 'failed'],
  travellingToPickup: ['loaded', 'failed'],
  loaded: ['delivering', 'failed'],
  delivering: ['completed', 'failed'],
  completed: [],
  failed: [],
});

export const MISSION_FAILURE_REASONS = ['abandoned', 'cargoDamaged'] as const;
export type MissionFailureReason = (typeof MISSION_FAILURE_REASONS)[number];

/**
 * Runtime state of one accepted contract. Plain data that refers to its
 * MissionDefinition by id, so the save system (roadmap step 18) can store it.
 * MissionService changes it; everything else reads it.
 */
export interface MissionInstance {
  /** MissionDefinition id. */
  readonly missionId: string;
  state: MissionState;
  /** Seconds the truck has stood in the current bay, loading or unloading. */
  handlingSeconds: number;
  /** The delivery clock: seconds since the cargo was loaded. */
  deliverySeconds: number;
  /** 0 = pristine, 1 = destroyed. */
  cargoDamage: Fraction;
  failureReason: MissionFailureReason | null;
}

export function createMissionInstance(missionId: string): MissionInstance {
  return {
    missionId,
    state: 'accepted',
    handlingSeconds: 0,
    deliverySeconds: 0,
    cargoDamage: 0,
    failureReason: null,
  };
}

/** True once the contract has ended, either way. */
export function isMissionFinished(mission: Readonly<MissionInstance>): boolean {
  return mission.state === 'completed' || mission.state === 'failed';
}

/** True while the cargo is on the truck. */
export function isCargoAboard(mission: Readonly<MissionInstance>): boolean {
  return mission.state === 'loaded' || mission.state === 'delivering';
}

/** Moves the mission to `next`. Throws for a transition MISSION_STATE_TRANSITIONS does not allow. */
export function transitionMission(mission: MissionInstance, next: MissionState): void {
  if (!MISSION_STATE_TRANSITIONS[mission.state].includes(next)) {
    throw new Error(`Invalid mission state transition for ${mission.missionId}: ${mission.state} -> ${next}.`);
  }
  mission.state = next;
  mission.handlingSeconds = 0;
}

/** Ends the mission as failed. Throws if it has already finished. */
export function failMission(mission: MissionInstance, reason: MissionFailureReason): void {
  transitionMission(mission, 'failed');
  mission.failureReason = reason;
}
