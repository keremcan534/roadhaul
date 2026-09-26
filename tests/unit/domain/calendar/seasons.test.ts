import { describe, expect, it } from 'vitest';
import { seasonOf } from '../../../../src/domain/calendar/seasons';

const at = (date: string): number => Date.parse(`${date}T12:00:00Z`);

describe('seasonOf', () => {
  it('goes round the northern year: spring from March, summer from June, autumn from September, winter from December', () => {
    expect(seasonOf(at('2026-01-15'))).toBe('winter');
    expect(seasonOf(at('2026-02-27'))).toBe('winter');
    expect(seasonOf(at('2026-03-02'))).toBe('spring');
    expect(seasonOf(at('2026-05-30'))).toBe('spring');
    expect(seasonOf(at('2026-06-02'))).toBe('summer');
    expect(seasonOf(at('2026-08-30'))).toBe('summer');
    expect(seasonOf(at('2026-09-02'))).toBe('autumn');
    expect(seasonOf(at('2026-09-26'))).toBe('autumn');
    expect(seasonOf(at('2026-11-29'))).toBe('autumn');
    expect(seasonOf(at('2026-12-02'))).toBe('winter');
    expect(seasonOf(at('2030-07-01'))).toBe('summer');
  });
});
