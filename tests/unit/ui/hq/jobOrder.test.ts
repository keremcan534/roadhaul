import { describe, expect, it } from 'vitest';
import type { JobOffer } from '../../../../src/systems/missions/MissionService';
import { sortJobOffers } from '../../../../src/ui/hq/jobOrder';

function offer(id: string, blockedBy: JobOffer['blockedBy'], requiredCompanyLevel = 1): JobOffer {
  return { mission: { id }, blockedBy, requiredCompanyLevel } as unknown as JobOffer;
}

describe('sortJobOffers', () => {
  it('puts what can be taken first, then what needs a truck, then what needs a level, lowest first', () => {
    const offers = [
      offer('level_3', 'companyLevel', 3),
      offer('open_a', null),
      offer('truck_a', 'truck', 2),
      offer('level_2', 'companyLevel', 2),
      offer('open_b', null),
      offer('truck_b', 'truck'),
    ];

    expect(sortJobOffers(offers).map((job) => job.mission.id)).toEqual([
      'open_a',
      'open_b',
      'truck_a',
      'truck_b',
      'level_2',
      'level_3',
    ]);
    expect(offers[0]!.mission.id).toBe('level_3'); // The board's list is left alone.
  });
});
