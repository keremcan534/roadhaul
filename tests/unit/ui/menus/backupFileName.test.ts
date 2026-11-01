import { describe, expect, it } from 'vitest';
import { backupFileName } from '../../../../src/ui/menus/backupFileName';

describe('a backup\'s file name', () => {
  it('names the company in plain letters and the day', () => {
    const day = new Date(2026, 10, 1, 23, 59);
    expect(backupFileName('Kuzey Lojistik', day)).toBe('roadhaul-kuzey-lojistik-20261101.json');
    expect(backupFileName('Işık Taşımacılık & Co.', day)).toBe('roadhaul-isik-tasimacilik-co-20261101.json');
    expect(backupFileName('Łódź Straße', day)).toBe('roadhaul-lodz-strasse-20261101.json');
    expect(backupFileName('Северный путь', day)).toBe('roadhaul-company-20261101.json');
    expect(backupFileName(' A very long company name that goes on and on ', day)).toBe('roadhaul-a-very-long-company-name-that-go-20261101.json');
  });
});
