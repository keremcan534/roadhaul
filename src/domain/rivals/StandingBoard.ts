import type { Fraction } from '../../data/units';

/** Standing worn below this is gone: it keeps the save from filling with specks. */
const NEGLIGIBLE_POINTS = 0.01;

/** One company's standing in one city, as the save keeps it. */
export interface StandingEntry {
  readonly cityId: string;
  readonly companyId: string;
  readonly points: number;
}

/**
 * How well each company stands in each city (its market share there): the
 * points deliveries, tenders and campaigns win it, which time wears away,
 * halving over a half-life, so that what was delivered lately counts most.
 * Wear takes the same share from every company, so the shares hold while
 * nothing happens. A city's leader has the most points there, and at least
 * `leadShare` of them; with a tie at the top, or nobody far enough ahead,
 * the city is contested. The cities and companies are fixed when it is
 * made. Allocation-free except entries().
 */
export class StandingBoard {
  private readonly points: Float64Array;
  private readonly cityIndex: ReadonlyMap<string, number>;
  private readonly companyIndex: ReadonlyMap<string, number>;

  constructor(
    readonly cityIds: readonly string[],
    readonly companyIds: readonly string[],
  ) {
    this.points = new Float64Array(cityIds.length * companyIds.length);
    this.cityIndex = new Map(cityIds.map((id, index) => [id, index]));
    this.companyIndex = new Map(companyIds.map((id, index) => [id, index]));
  }

  /** Whether the board keeps standing in `cityId`. */
  hasCity(cityId: string): boolean {
    return this.cityIndex.has(cityId);
  }

  pointsOf(cityId: string, companyId: string): number {
    return this.points[this.slot(cityId, companyId)]!;
  }

  /** Every company's points in `cityId` together. */
  total(cityId: string): number {
    const start = this.row(cityId);
    let sum = 0;
    for (let i = 0; i < this.companyIds.length; i++) {
      sum += this.points[start + i]!;
    }
    return sum;
  }

  /** `companyId`'s share of the standing in `cityId`; 0 while nobody has any. */
  shareOf(cityId: string, companyId: string): Fraction {
    const total = this.total(cityId);
    return total > 0 ? this.pointsOf(cityId, companyId) / total : 0;
  }

  /** The company leading in `cityId`, or null while it is contested. */
  leaderOf(cityId: string, leadShare: Fraction): string | null {
    const start = this.row(cityId);
    let best = -1;
    let bestPoints = 0;
    let tied = false;
    let total = 0;
    for (let i = 0; i < this.companyIds.length; i++) {
      const points = this.points[start + i]!;
      total += points;
      if (points > bestPoints) {
        best = i;
        bestPoints = points;
        tied = false;
      } else if (points === bestPoints && points > 0) {
        tied = true;
      }
    }
    return best >= 0 && !tied && bestPoints >= leadShare * total ? this.companyIds[best]! : null;
  }

  /** `companyId` wins `points` of standing in `cityId`. */
  add(cityId: string, companyId: string, points: number): void {
    if (!(points > 0)) {
      return;
    }
    this.points[this.slot(cityId, companyId)]! += points;
  }

  /** Sets `companyId`'s standing in `cityId` (a loaded game); below 0 or not finite counts as none. */
  set(cityId: string, companyId: string, points: number): void {
    this.points[this.slot(cityId, companyId)] = points > 0 && Number.isFinite(points) ? points : 0;
  }

  /** Wears all standing down over `seconds` of play: it halves every `halfLifeSeconds`. */
  wear(seconds: number, halfLifeSeconds: number): void {
    if (!(seconds > 0)) {
      return;
    }
    const factor = Math.pow(0.5, seconds / halfLifeSeconds);
    const points = this.points;
    for (let i = 0; i < points.length; i++) {
      const worn = points[i]! * factor;
      points[i] = worn < NEGLIGIBLE_POINTS ? 0 : worn;
    }
  }

  /** Everything `fromCompanyId` has in every city goes to `toCompanyId` (a buy-out). */
  transfer(fromCompanyId: string, toCompanyId: string): void {
    for (const cityId of this.cityIds) {
      const from = this.slot(cityId, fromCompanyId);
      this.points[this.slot(cityId, toCompanyId)]! += this.points[from]!;
      this.points[from] = 0;
    }
  }

  clear(): void {
    this.points.fill(0);
  }

  /** Every standing above nothing, city by city (for the save). Allocates. */
  entries(): StandingEntry[] {
    const entries: StandingEntry[] = [];
    this.cityIds.forEach((cityId, city) => {
      this.companyIds.forEach((companyId, company) => {
        const points = this.points[city * this.companyIds.length + company]!;
        if (points > 0) {
          entries.push({ cityId, companyId, points });
        }
      });
    });
    return entries;
  }

  private row(cityId: string): number {
    const city = this.cityIndex.get(cityId);
    if (city === undefined) {
      throw new Error(`Unknown city "${cityId}" on the standing board.`);
    }
    return city * this.companyIds.length;
  }

  private slot(cityId: string, companyId: string): number {
    const company = this.companyIndex.get(companyId);
    if (company === undefined) {
      throw new Error(`Unknown company "${companyId}" on the standing board.`);
    }
    return this.row(cityId) + company;
  }
}
