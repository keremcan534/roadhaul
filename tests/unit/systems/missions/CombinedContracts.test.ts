import { describe, expect, it } from 'vitest';
import type { MissionDefinition } from '../../../../src/data/definitions/MissionDefinition';
import { CombinedContracts } from '../../../../src/systems/missions/CombinedContracts';
import type { ContractSource } from '../../../../src/systems/missions/DailyContracts';
import { TenderBoard } from '../../../../src/systems/rivals/TenderBoard';
import { missionFixture } from '../../../support/contentFixtures';

/** A source whose contracts the test swaps. */
function source(contracts: readonly MissionDefinition[]): ContractSource & { contracts: readonly MissionDefinition[] } {
  return {
    contracts,
    current() {
      return this.contracts;
    },
  };
}

describe('CombinedContracts', () => {
  it('offers the contracts of every source in turn, the same array until one of them changes', () => {
    const daily = source([missionFixture({ id: 'daily_1_1' }), missionFixture({ id: 'daily_1_2' })]);
    const tenders = new TenderBoard();
    const combined = new CombinedContracts([daily, tenders]);

    const first = combined.current();
    expect(first.map((contract) => contract.id)).toEqual(['daily_1_1', 'daily_1_2']);
    expect(combined.current()).toBe(first);

    const tender = missionFixture({ id: 'daily_tender_1' });
    tenders.post({ contract: tender, rivalId: 'test_rival', prize: 300, rivalSeconds: 200 });
    expect(combined.current().map((contract) => contract.id)).toEqual(['daily_1_1', 'daily_1_2', 'daily_tender_1']);
    expect(tenders.tender?.contract).toBe(tender);

    daily.contracts = [missionFixture({ id: 'daily_2_1' })];
    expect(combined.current().map((contract) => contract.id)).toEqual(['daily_2_1', 'daily_tender_1']);
    tenders.post(null);
    expect(combined.current().map((contract) => contract.id)).toEqual(['daily_2_1']);
    expect(tenders.tender).toBeNull();
  });
});
