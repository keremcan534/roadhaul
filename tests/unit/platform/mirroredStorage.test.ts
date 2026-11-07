import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../../src/core/storage/KeyValueStorage';
import { MirroredStorage, restoreMirror, type MirrorFiles } from '../../../src/platform/native/mirroredStorage';

class MemoryFiles implements MirrorFiles {
  readonly files = new Map<string, string>();
  writes = 0;
  failing = false;

  read(name: string): Promise<string | null> {
    return Promise.resolve(this.files.get(name) ?? null);
  }

  async write(name: string, text: string): Promise<void> {
    await Promise.resolve();
    if (this.failing) {
      throw new Error('disk full');
    }
    this.writes++;
    this.files.set(name, text);
  }

  remove(name: string): Promise<void> {
    this.files.delete(name);
    return Promise.resolve();
  }
}

describe('MirroredStorage', () => {
  it('keeps the save and the settings in files too, the latest value of each, but not the passing slots', async () => {
    const inner = new MemoryStorage();
    const files = new MemoryFiles();
    const storage = new MirroredStorage(inner, files);
    storage.setItem('roadhaul.save', 'one');
    storage.setItem('roadhaul.save', 'two');
    storage.setItem('roadhaul.settings', '{}');
    storage.setItem('roadhaul.save.pending', 'passing');
    expect(storage.getItem('roadhaul.save')).toBe('two');
    await storage.flush();
    expect(files.files.get('roadhaul.save.json')).toBe('two');
    expect(files.files.get('roadhaul.settings.json')).toBe('{}');
    expect(files.files.has('roadhaul.save.pending.json')).toBe(false);
    // The first write was under way when the second came: two writes of the save, then the settings.
    expect(files.writes).toBeLessThanOrEqual(3);

    storage.removeItem('roadhaul.settings');
    await storage.flush();
    expect(files.files.has('roadhaul.settings.json')).toBe(false);
  });

  it('tells of a write that failed, and keeps the game going', async () => {
    const files = new MemoryFiles();
    files.failing = true;
    const failed: string[] = [];
    const storage = new MirroredStorage(new MemoryStorage(), files, (key) => failed.push(key));
    storage.setItem('roadhaul.save', 'one');
    await storage.flush();
    expect(failed).toEqual(['roadhaul.save']);
    expect(storage.getItem('roadhaul.save')).toBe('one');
  });
});

describe('restoreMirror', () => {
  it('brings the company and the settings back to a device with none (a new phone, a reinstall)', async () => {
    const files = new MemoryFiles();
    files.files.set('roadhaul.save.json', 'company');
    files.files.set('roadhaul.settings.json', 'settings');
    const storage = new MemoryStorage();
    expect(await restoreMirror(storage, files)).toEqual(['roadhaul.save', 'roadhaul.settings']);
    expect(storage.getItem('roadhaul.save')).toBe('company');
    expect(storage.getItem('roadhaul.settings')).toBe('settings');
  });

  it('leaves a device that has a company alone', async () => {
    const files = new MemoryFiles();
    files.files.set('roadhaul.save.json', 'old company');
    files.files.set('roadhaul.settings.json', 'old settings');
    const storage = new MemoryStorage();
    storage.setItem('roadhaul.save', 'this company');
    expect(await restoreMirror(storage, files)).toEqual([]);
    expect(storage.getItem('roadhaul.save')).toBe('this company');
    expect(storage.getItem('roadhaul.settings')).toBeNull();
  });

  it('writes what the device holds at once, for a game that had no mirror before', async () => {
    const storage = new MemoryStorage();
    storage.setItem('roadhaul.save', 'company');
    storage.setItem('roadhaul.save.pending', 'passing');
    const files = new MemoryFiles();
    const mirrored = new MirroredStorage(storage, files);
    mirrored.mirrorAll();
    await mirrored.flush();
    expect([...files.files.keys()]).toEqual(['roadhaul.save.json']);
  });
});
