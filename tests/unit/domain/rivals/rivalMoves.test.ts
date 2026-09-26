import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../../../../src/core/random/SeededRandom';
import { campaignTarget, nextLeader, rivalDestination } from '../../../../src/domain/rivals/rivalMoves';
import { StandingBoard } from '../../../../src/domain/rivals/StandingBoard';

const CITIES = ['city_a', 'city_b', 'city_c'];

/** Draws `rolls` in turn. */
function rolls(...values: number[]) {
  let index = 0;
  return { next: () => values[index++ % values.length]! };
}

function destination(overrides: { fromCityId?: string; playerCities?: string[]; aggression?: number; random?: { next(): number } }) {
  return rivalDestination({
    cityIds: CITIES,
    fromCityId: overrides.fromCityId ?? 'city_a',
    homeCityId: 'city_a',
    playerCities: overrides.playerCities ?? [],
    aggression: overrides.aggression ?? 0.5,
    random: overrides.random ?? new SeededRandom(1),
  });
}

describe('rivalDestination', () => {
  it('goes to another city, from home to either of the others', () => {
    const seen = new Set<string | null>();
    const random = new SeededRandom(7);
    for (let i = 0; i < 200; i++) {
      seen.add(destination({ random }));
    }
    expect(seen).toEqual(new Set(['city_b', 'city_c']));
    expect(rivalDestination({ cityIds: ['city_a'], fromCityId: 'city_a', homeCityId: 'city_a', playerCities: [], aggression: 1, random: rolls(0) })).toBeNull();
  });

  it('heads home from away about half the time', () => {
    const random = new SeededRandom(3);
    let home = 0;
    for (let i = 0; i < 2000; i++) {
      if (destination({ fromCityId: 'city_b', random }) === 'city_a') {
        home++;
      }
    }
    // Half the time straight home, and half of the rest by chance.
    expect(home).toBeGreaterThan(1350);
    expect(home).toBeLessThan(1650);
  });

  it('sends trucks into the cities the player leads, the more the more aggressive it is', () => {
    const attacks = (aggression: number) => {
      const random = new SeededRandom(11);
      let count = 0;
      for (let i = 0; i < 2000; i++) {
        if (destination({ fromCityId: 'city_b', playerCities: ['city_c'], aggression, random }) === 'city_c') {
          count++;
        }
      }
      return count;
    };
    // Without aggression only by chance (a quarter of the time); fully aggressive 60% more.
    expect(attacks(0)).toBeGreaterThan(400);
    expect(attacks(0)).toBeLessThan(600);
    expect(attacks(1)).toBeGreaterThan(1250);
    expect(destination({ playerCities: ['city_b'], aggression: 1, random: rolls(0.1, 0.9, 0.9) })).toBe('city_b');
    // It never attacks the city it is in.
    expect(destination({ fromCityId: 'city_b', playerCities: ['city_b'], aggression: 1, random: rolls(0, 0.9, 0.2) })).toBe('city_a');
  });
});

describe('campaignTarget', () => {
  function standing(points: Record<string, Record<string, number>>): StandingBoard {
    const board = new StandingBoard(CITIES, ['player', 'rival_x', 'rival_y']);
    for (const [cityId, companies] of Object.entries(points)) {
      for (const [companyId, value] of Object.entries(companies)) {
        board.add(cityId, companyId, value);
      }
    }
    return board;
  }
  const target = (board: StandingBoard) =>
    campaignTarget(board, (cityId) => board.leaderOf(cityId, 0.35), 'rival_x', 'city_a', 'player');

  it('defends a slipping lead first', () => {
    const board = standing({
      city_a: { rival_x: 50, player: 45 },
      city_b: { player: 60, rival_x: 40 },
      city_c: { rival_y: 100 },
    });
    expect(target(board)).toEqual({ cityId: 'city_a', aim: 'defend' });
  });

  it('otherwise goes where it stands to gain most: its share, its home, and the player\'s cities count', () => {
    // Safe at home; the player's city beats the other rival's though it has less there.
    const board = standing({
      city_a: { rival_x: 90, player: 10 },
      city_b: { player: 70, rival_x: 30 },
      city_c: { rival_y: 55, rival_x: 45 },
    });
    expect(target(board)).toEqual({ cityId: 'city_b', aim: 'attack' });
    // Home comes before a city where it is as strong.
    const lost = standing({
      city_a: { player: 70, rival_x: 30 },
      city_b: { player: 70, rival_x: 30 },
      city_c: { rival_y: 100 },
    });
    expect(target(lost)).toEqual({ cityId: 'city_a', aim: 'attack' });
    // Against another rival, it is out to win ground.
    const elsewhere = standing({
      city_a: { rival_x: 90, player: 10 },
      city_b: { rival_y: 70, rival_x: 30 },
      city_c: { rival_y: 100 },
    });
    expect(target(elsewhere)).toEqual({ cityId: 'city_b', aim: 'expand' });
  });

  it('runs none while it leads everywhere safely', () => {
    const board = standing({
      city_a: { rival_x: 90 },
      city_b: { rival_x: 60, player: 20 },
      city_c: { rival_x: 50, rival_y: 30 },
    });
    expect(target(board)).toBeNull();
  });
});

describe('nextLeader', () => {
  function board(points: Record<string, number>): StandingBoard {
    const standing = new StandingBoard(['city_a'], ['player', 'rival_x', 'rival_y']);
    for (const [companyId, value] of Object.entries(points)) {
      standing.add('city_a', companyId, value);
    }
    return standing;
  }
  const next = (points: Record<string, number>, current: string | null) => nextLeader(board(points), 'city_a', current, 0.35, 0.03);

  it('lets the leader keep the city until a challenger is clearly ahead', () => {
    expect(next({ rival_x: 50, player: 51 }, 'rival_x')).toBe('rival_x');
    expect(next({ rival_x: 50, player: 53 }, 'rival_x')).toBe('rival_x'); // 51.5% against 48.5%: not quite 3 points clear.
    expect(next({ rival_x: 50, player: 57 }, 'rival_x')).toBe('player');
  });

  it('takes the city from a leader who falls below the lead share, and gives a free city to whoever leads it', () => {
    expect(next({ rival_x: 33, player: 33, rival_y: 34 }, 'rival_x')).toBe('rival_x'); // 33% is nearly 35%.
    expect(next({ rival_x: 30, player: 30, rival_y: 40 }, 'rival_x')).toBe('rival_y');
    expect(next({ rival_x: 30, player: 35, rival_y: 35 }, 'rival_x')).toBeNull(); // Tied at the top: contested.
    expect(next({ player: 10 }, null)).toBe('player');
    expect(next({}, 'rival_x')).toBeNull();
  });
});
