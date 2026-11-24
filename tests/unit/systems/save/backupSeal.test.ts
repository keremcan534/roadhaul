import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, openBackup, sealBackup } from '../../../../src/systems/save/backupSeal';

const save = { version: 27, profile: { companyName: 'Kuzey Lojistik' }, economy: { credits: 5000 } };

describe('backupSeal', () => {
  it('seals a save and opens it again as the same JSON', () => {
    const text = sealBackup(save);
    const file = JSON.parse(text) as { kind: string; format: number; seal: string; save: unknown };

    expect(file.kind).toBe('roadhaul-backup');
    expect(file.format).toBe(BACKUP_FORMAT);
    expect(file.seal).toMatch(/^[0-9a-f]{64}$/);
    expect(file.save).toEqual(save);
    expect(openBackup(text)).toEqual({ ok: true, value: JSON.stringify(save) });
  });

  it('opens a backup only reformatted, whatever its spacing', () => {
    const text = sealBackup(save);

    expect(openBackup(JSON.stringify(JSON.parse(text), null, 4)).ok).toBe(true);
  });

  it('refuses a backup with any value changed, or its seal changed or taken away', () => {
    const file = JSON.parse(sealBackup(save)) as { seal: string; save: { economy: { credits: number } } };
    const richer = { ...file, save: { ...file.save, economy: { credits: 99_999_999 } } };
    const resealed = { ...file, seal: '0'.repeat(64) };
    const { seal: _seal, ...unsealed } = file;

    for (const changed of [richer, resealed, unsealed, { ...file, seal: 7 }, { ...file, save: [] }, { ...file, format: 1 }]) {
      expect(openBackup(JSON.stringify(changed))).toEqual({ ok: false, error: 'unsealed' });
    }
  });

  it('calls a bare save unsealed (a backup from before seals), and anything else no backup', () => {
    expect(openBackup(JSON.stringify(save))).toEqual({ ok: false, error: 'unsealed' });
    for (const text of ['', 'hello', '[1, 2]', 'null', '{"shopping": ["diesel"]}', '{"kind": "roadhaul-backup"}']) {
      expect(openBackup(text)).toEqual({ ok: false, error: 'unreadable' });
    }
  });

  it('leaves a layout from a newer version to that version', () => {
    const file = JSON.parse(sealBackup(save)) as Record<string, unknown>;

    expect(openBackup(JSON.stringify({ ...file, format: BACKUP_FORMAT + 1 }))).toEqual({ ok: false, error: 'tooNew' });
  });
});
