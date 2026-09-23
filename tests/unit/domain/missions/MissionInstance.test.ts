import { describe, expect, it } from 'vitest';
import {
  createMissionInstance,
  failMission,
  isCargoAboard,
  isMissionFinished,
  MISSION_STATE_TRANSITIONS,
  MISSION_STATES,
  transitionMission,
  type MissionState,
} from '../../../../src/domain/missions/MissionInstance';

describe('MissionInstance', () => {
  it('starts accepted, with a stopped clock and pristine cargo', () => {
    expect(createMissionInstance('first_package')).toEqual({
      missionId: 'first_package',
      state: 'accepted',
      handlingSeconds: 0,
      deliverySeconds: 0,
      cargoDamage: 0,
      failureReason: null,
    });
  });

  it('follows the delivery stages to completion (spec §50)', () => {
    const mission = createMissionInstance('first_package');
    const seen: MissionState[] = [mission.state];
    for (const next of ['travellingToPickup', 'loaded', 'delivering', 'completed'] as const) {
      transitionMission(mission, next);
      seen.push(mission.state);
    }

    expect(seen).toEqual(['accepted', 'travellingToPickup', 'loaded', 'delivering', 'completed']);
    expect(isMissionFinished(mission)).toBe(true);
  });

  it('can fail from every unfinished stage, and remembers why', () => {
    for (const state of MISSION_STATES) {
      if (state === 'completed' || state === 'failed') {
        continue;
      }
      const mission = { ...createMissionInstance('first_package'), state };
      failMission(mission, 'abandoned');

      expect(mission.state, state).toBe('failed');
      expect(mission.failureReason).toBe('abandoned');
    }
  });

  it('rejects skipped stages and changes after the end', () => {
    const mission = createMissionInstance('first_package');

    expect(() => transitionMission(mission, 'delivering')).toThrow(
      'Invalid mission state transition for first_package: accepted -> delivering.',
    );
    failMission(mission, 'cargoDamaged');
    expect(() => failMission(mission, 'abandoned')).toThrow('failed -> failed');
    expect(mission.failureReason).toBe('cargoDamaged');
    expect(MISSION_STATE_TRANSITIONS.completed).toEqual([]);
  });

  it('restarts the loading timer at every stage', () => {
    const mission = createMissionInstance('first_package');
    transitionMission(mission, 'travellingToPickup');
    mission.handlingSeconds = 2.5;

    transitionMission(mission, 'loaded');

    expect(mission.handlingSeconds).toBe(0);
  });

  it('knows when the cargo is aboard', () => {
    const aboard = MISSION_STATES.filter((state) => isCargoAboard({ ...createMissionInstance('m'), state }));

    expect(aboard).toEqual(['loaded', 'delivering']);
  });
});
