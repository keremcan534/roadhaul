import type { MissionDefinition } from '../../data/definitions/MissionDefinition';
import type { ContractSource } from './DailyContracts';

/**
 * Several sources of generated contracts on one job board (the contracts of
 * the day, the tenders): their contracts in turn, the same array until one
 * of the sources has changed its own.
 */
export class CombinedContracts implements ContractSource {
  private readonly parts: (readonly MissionDefinition[])[] = [];
  private contracts: readonly MissionDefinition[] = [];

  constructor(private readonly sources: readonly ContractSource[]) {}

  current(): readonly MissionDefinition[] {
    let changed = false;
    for (let i = 0; i < this.sources.length; i++) {
      const part = this.sources[i]!.current();
      if (this.parts[i] !== part) {
        this.parts[i] = part;
        changed = true;
      }
    }
    if (changed) {
      this.contracts = this.parts.flat();
    }
    return this.contracts;
  }
}
