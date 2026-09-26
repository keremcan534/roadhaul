import { describe, expect, it } from 'vitest';
import { StandingBoard } from '../../../../src/domain/rivals/StandingBoard';

function board(): StandingBoard {
  return new StandingBoard(['city_a', 'city_b'], ['player', 'rival_x', 'rival_y']);
}

describe('StandingBoard', () => {
  it('adds up each company\'s standing in each city, and its share there', () => {
    const standing = board();
    standing.add('city_a', 'player', 30);
    standing.add('city_a', 'rival_x', 10);
    standing.add('city_a', 'player', 20);
    standing.add('city_b', 'rival_y', 5);
    standing.add('city_b', 'rival_y', -5); // Nothing is taken away by adding.

    expect(standing.pointsOf('city_a', 'player')).toBe(50);
    expect(standing.total('city_a')).toBe(60);
    expect(standing.shareOf('city_a', 'player')).toBeCloseTo(50 / 60, 10);
    expect(standing.shareOf('city_b', 'rival_y')).toBe(1);
    expect(standing.shareOf('city_b', 'player')).toBe(0);
    expect(board().shareOf('city_a', 'player')).toBe(0);
  });

  it('has a leader with the most standing and at least the lead share; a tie or a thin lead leaves the city contested', () => {
    const standing = board();
    expect(standing.leaderOf('city_a', 0.35)).toBeNull();
    standing.add('city_a', 'rival_x', 10);
    expect(standing.leaderOf('city_a', 0.35)).toBe('rival_x');
    standing.add('city_a', 'player', 10);
    expect(standing.leaderOf('city_a', 0.35)).toBeNull(); // Tied at the top.
    standing.add('city_a', 'player', 1);
    expect(standing.leaderOf('city_a', 0.35)).toBe('player');
    standing.add('city_a', 'rival_y', 20);
    expect(standing.leaderOf('city_a', 0.35)).toBe('rival_y'); // 20 of 41: 49%.
    expect(standing.leaderOf('city_a', 0.5)).toBeNull();
  });

  it('wears standing away by half every half-life, keeping the shares, and drops specks', () => {
    const standing = board();
    standing.add('city_a', 'player', 80);
    standing.add('city_a', 'rival_x', 20);
    standing.add('city_b', 'rival_y', 0.015);
    standing.wear(1800, 1800);
    expect(standing.pointsOf('city_a', 'player')).toBeCloseTo(40, 10);
    expect(standing.shareOf('city_a', 'player')).toBeCloseTo(0.8, 10);
    expect(standing.pointsOf('city_b', 'rival_y')).toBe(0);
    standing.wear(0, 1800);
    standing.wear(-5, 1800);
    expect(standing.pointsOf('city_a', 'player')).toBeCloseTo(40, 10);
    // Wearing in steps comes to the same as at once.
    for (let i = 0; i < 60; i++) {
      standing.wear(30, 1800);
    }
    expect(standing.pointsOf('city_a', 'player')).toBeCloseTo(20, 8);
  });

  it('hands a bought-out company\'s standing to its buyer, and lists and sets standing for the save', () => {
    const standing = board();
    standing.add('city_a', 'rival_x', 12);
    standing.add('city_b', 'rival_x', 7);
    standing.add('city_b', 'player', 3);
    standing.transfer('rival_x', 'player');
    expect(standing.entries()).toEqual([
      { cityId: 'city_a', companyId: 'player', points: 12 },
      { cityId: 'city_b', companyId: 'player', points: 10 },
    ]);

    const loaded = board();
    for (const entry of standing.entries()) {
      loaded.set(entry.cityId, entry.companyId, entry.points);
    }
    loaded.set('city_a', 'rival_y', Number.NaN);
    loaded.set('city_b', 'rival_y', -4);
    expect(loaded.entries()).toEqual(standing.entries());
    loaded.clear();
    expect(loaded.entries()).toEqual([]);
  });

  it('throws for cities and companies it does not keep', () => {
    const standing = board();
    expect(standing.hasCity('city_a')).toBe(true);
    expect(standing.hasCity('city_z')).toBe(false);
    expect(() => standing.add('city_z', 'player', 1)).toThrow(/city_z/);
    expect(() => standing.pointsOf('city_a', 'rival_z')).toThrow(/rival_z/);
  });
});
