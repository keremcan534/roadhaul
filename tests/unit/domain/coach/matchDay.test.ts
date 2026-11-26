import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { matchPhase } from '../../../../src/domain/coach/matchDay';

const hours = DEFAULT_GAME_CONFIG.coachLines.charter;

describe('matchPhase', () => {
  it('is quiet in the morning, runs the charter in the afternoon, has the match on in the evening, and is quiet after', () => {
    expect(matchPhase(9, hours)).toBe('quiet');
    expect(matchPhase(hours.fromHour - 0.01, hours)).toBe('quiet');
    expect(matchPhase(hours.fromHour, hours)).toBe('charter');
    expect(matchPhase(hours.kickOffHour - 0.01, hours)).toBe('charter');
    expect(matchPhase(hours.kickOffHour, hours)).toBe('match');
    expect(matchPhase(hours.kickOffHour + hours.matchHours - 0.01, hours)).toBe('match');
    expect(matchPhase(hours.kickOffHour + hours.matchHours, hours)).toBe('quiet');
    expect(matchPhase(23.5, hours)).toBe('quiet');
  });
});
