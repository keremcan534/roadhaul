import { describe, expect, it } from 'vitest';
import { MemoryStorage, type KeyValueStorage } from '../../../../src/core/storage/KeyValueStorage';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import { createNewSaveGameData } from '../../../../src/domain/save/createNewSaveGameData';
import type { SaveGameData } from '../../../../src/domain/save/SaveGameData';
import { SAVE_KEYS, SaveService } from '../../../../src/systems/save/SaveService';
import { contentFixture, vehicleFixture } from '../../../support/contentFixtures';
import { MemoryLogger } from '../../../support/MemoryLogger';

const content = ContentCatalog.create(contentFixture());

function newSave(credits = 5000): SaveGameData {
  return createNewSaveGameData({
    companyName: 'Kuzey Lojistik',
    startingCredits: credits,
    startingVehicle: vehicleFixture(),
    startingMapId: 'test_map',
    nowMs: 1000,
  });
}

function setup(storage: KeyValueStorage = new MemoryStorage()) {
  const logger = new MemoryLogger();
  const service = new SaveService(storage, content, { migration: { defaultMapId: 'test_map' }, maxCompanyLevel: 5 }, logger);
  return { service, storage, logger };
}

describe('SaveService', () => {
  it('reports a missing save for a new player', () => {
    const { service } = setup();

    expect(service.hasSave()).toBe(false);
    expect(service.load()).toEqual({ ok: false, error: 'missing' });
  });

  it('saves and loads a game unchanged, leaving no pending write behind', () => {
    const { service, storage } = setup();
    const save = newSave();

    expect(service.save(save)).toEqual({ ok: true, value: undefined });

    expect(service.hasSave()).toBe(true);
    expect(service.load()).toEqual({ ok: true, value: save });
    expect(storage.getItem(SAVE_KEYS.pending)).toBeNull();
  });

  it('keeps the previous save as a backup and falls back to it when the latest is unreadable', () => {
    const { service, storage, logger } = setup();
    service.save(newSave(1000));
    service.save(newSave(2000));
    expect(JSON.parse(storage.getItem(SAVE_KEYS.backup)!).economy.credits).toBe(1000);

    storage.setItem(SAVE_KEYS.main, '{"version": 2, "trunc');
    const loaded = service.load();

    expect(loaded.ok && loaded.value.economy.credits).toBe(1000);
    expect(logger.messages('warn').some((message) => message.includes('backup'))).toBe(true);
  });

  it('reports corruption when nothing is readable, and sets the data aside', () => {
    const { service, storage } = setup();
    storage.setItem(SAVE_KEYS.main, 'not json');
    storage.setItem(SAVE_KEYS.backup, JSON.stringify({ version: 2, economy: { credits: -5 } }));

    expect(service.load()).toEqual({ ok: false, error: 'corrupted' });
    expect(storage.getItem(SAVE_KEYS.unreadable)).toBe('not json');
    expect(service.hasSave()).toBe(false);
  });

  it('rejects saves whose content references no longer exist', () => {
    const { service, storage } = setup();
    const save = newSave();
    storage.setItem(SAVE_KEYS.main, JSON.stringify({ ...save, world: { mapId: 'deleted_map', truck: null } }));

    expect(service.load()).toEqual({ ok: false, error: 'corrupted' });
  });

  it('upgrades an older save on load', () => {
    const { service, storage } = setup();
    const { world: _world, missions: _missions, stats: _stats, ...v1 } = newSave();
    storage.setItem(SAVE_KEYS.main, JSON.stringify({ ...v1, version: 1 }));

    const loaded = service.load();

    expect(loaded.ok && loaded.value.version).toBe(2);
    expect(loaded.ok && loaded.value.world).toEqual({ mapId: 'test_map', truck: null });
  });

  it('never touches a save from a newer build', () => {
    const { service, storage } = setup();
    const future = JSON.stringify({ ...newSave(), version: 99 });
    storage.setItem(SAVE_KEYS.main, future);

    expect(service.load()).toEqual({ ok: false, error: 'tooNew' });
    expect(storage.getItem(SAVE_KEYS.main)).toBe(future);
  });

  it('refuses to overwrite a good save with invalid data', () => {
    const { service, storage, logger } = setup();
    service.save(newSave(1000));

    const broken = { ...newSave(), economy: { credits: -1 } } as SaveGameData;

    expect(service.save(broken)).toEqual({ ok: false, error: 'invalid' });
    expect(JSON.parse(storage.getItem(SAVE_KEYS.main)!).economy.credits).toBe(1000);
    expect(logger.messages('error')).toHaveLength(1);
  });

  it('reports storage failures instead of throwing, keeping the last good save', () => {
    const storage = new MemoryStorage();
    const { service } = setup(storage);
    service.save(newSave(1000));
    const full: KeyValueStorage = {
      getItem: (key) => storage.getItem(key),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: (key) => storage.removeItem(key),
    };

    expect(setup(full).service.save(newSave(2000))).toEqual({ ok: false, error: 'storageFailed' });
    const loaded = setup(storage).service.load();
    expect(loaded.ok && loaded.value.economy.credits).toBe(1000);
  });

  it('does not swap in a write that did not read back intact', () => {
    const storage = new MemoryStorage();
    setup(storage).service.save(newSave(1000));
    const garbling: KeyValueStorage = {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, key === SAVE_KEYS.pending ? value.slice(0, 10) : value),
      removeItem: (key) => storage.removeItem(key),
    };

    expect(setup(garbling).service.save(newSave(2000))).toEqual({ ok: false, error: 'storageFailed' });
    expect(JSON.parse(storage.getItem(SAVE_KEYS.main)!).economy.credits).toBe(1000);
  });

  it('treats unreadable storage as no save', () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {},
      removeItem: () => {},
    };
    const { service } = setup(broken);

    expect(service.hasSave()).toBe(false);
    expect(service.load()).toEqual({ ok: false, error: 'missing' });
  });

  it('deletes every slot', () => {
    const { service, storage } = setup();
    service.save(newSave());
    service.save(newSave());

    service.deleteAll();

    expect((storage as MemoryStorage).keys()).toEqual([]);
  });
});
