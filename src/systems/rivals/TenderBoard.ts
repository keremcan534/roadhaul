import type { MissionDefinition } from '../../data/definitions/MissionDefinition';
import type { Tender } from '../../domain/rivals/tenders';
import type { ContractSource } from '../missions/DailyContracts';

/**
 * The tender on the job board: RivalService puts one up, and MissionService
 * offers its contract with the others (through CombinedContracts) until it
 * is taken or the next replaces it.
 */
export class TenderBoard implements ContractSource {
  private posted: Tender | null = null;
  private contracts: readonly MissionDefinition[] = [];

  get tender(): Tender | null {
    return this.posted;
  }

  /** Puts `tender` up in place of the one there; null takes it down. */
  post(tender: Tender | null): void {
    this.posted = tender;
    this.contracts = tender === null ? [] : [tender.contract];
  }

  current(): readonly MissionDefinition[] {
    return this.contracts;
  }
}
