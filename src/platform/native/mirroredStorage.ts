import type { KeyValueStorage } from '../../core/storage/KeyValueStorage';

/**
 * Files the mirror is kept in: one per key, in a folder of the app's own that Android's backup carries to the
 * player's Google account (`android/app/src/main/res/xml/data_extraction_rules.xml`). Every call may fail.
 */
export interface MirrorFiles {
  /** The file's text, or null when there is none. */
  read(name: string): Promise<string | null>;
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
}

/**
 * What the mirror keeps: the company (and the save before it), the phone's settings, and what the player has from
 * the shop and the ads. Not the slots a save passes through, nor what only lasts the session.
 */
export const MIRRORED_KEYS: readonly string[] = [
  'roadhaul.save',
  'roadhaul.save.backup',
  'roadhaul.settings',
  'roadhaul.purchases',
  'roadhaul.earningsBoost',
  'roadhaul.serviceDiscounts',
  'roadhaul.adCrates',
  'roadhaul.review',
];

/** The key a fresh install looks for: no company on the device means the mirror may bring one back. */
const COMPANY_KEY = 'roadhaul.save';

function fileName(key: string): string {
  return `${key}.json`;
}

/**
 * The cloud save, through Android's own backup (Auto Backup to the player's Google account, and a phone-to-phone
 * transfer). The WebView's localStorage is a database Android's backup cannot be trusted to copy whole, so each key
 * that matters is also written to a plain file, and on a device with no company yet (a reinstall, a new phone) the
 * files bring the keys back before the game reads them.
 *
 * Writes happen after the storage call returns, the latest value of each key only, one at a time.
 */
export class MirroredStorage implements KeyValueStorage {
  private readonly waiting = new Map<string, string | null>();
  private writing: Promise<void> | null = null;

  constructor(
    private readonly inner: KeyValueStorage,
    private readonly files: MirrorFiles,
    private readonly onError: (key: string, error: unknown) => void = () => undefined,
    private readonly keys: readonly string[] = MIRRORED_KEYS,
  ) {}

  getItem(key: string): string | null {
    return this.inner.getItem(key);
  }

  setItem(key: string, value: string): void {
    this.inner.setItem(key, value);
    this.mirror(key, value);
  }

  removeItem(key: string): void {
    this.inner.removeItem(key);
    this.mirror(key, null);
  }

  /**
   * Writes every mirrored key the storage holds to its file, so a device that had the game before the mirror (or
   * whose files were lost) is covered at once rather than at the next save. Queued with the other writes, so a newer
   * value written meanwhile is never overwritten by an older one.
   */
  mirrorAll(): void {
    for (const key of this.keys) {
      const value = this.inner.getItem(key);
      if (value !== null) {
        this.mirror(key, value);
      }
    }
  }

  /** Resolves once every write asked for so far is done (tests; leaving the app). */
  async flush(): Promise<void> {
    while (this.writing !== null) {
      await this.writing;
    }
  }

  private mirror(key: string, value: string | null): void {
    if (!this.keys.includes(key)) {
      return;
    }
    this.waiting.set(key, value);
    this.writing ??= this.drain();
  }

  private async drain(): Promise<void> {
    try {
      for (let next = this.waiting.entries().next(); !next.done; next = this.waiting.entries().next()) {
        const [key, value] = next.value;
        this.waiting.delete(key);
        try {
          await (value === null ? this.files.remove(fileName(key)) : this.files.write(fileName(key), value));
        } catch (error) {
          this.onError(key, error);
        }
      }
    } finally {
      this.writing = null;
    }
  }
}

/**
 * On a device with no company, brings the mirrored keys back from their files (what Android's backup restored),
 * each only where the storage has none. Returns the keys brought back; none when a company is already here.
 */
export async function restoreMirror(
  storage: KeyValueStorage,
  files: MirrorFiles,
  keys: readonly string[] = MIRRORED_KEYS,
): Promise<string[]> {
  if (storage.getItem(COMPANY_KEY) !== null) {
    return [];
  }
  const restored: string[] = [];
  for (const key of keys) {
    if (storage.getItem(key) !== null) {
      continue;
    }
    const text = await files.read(fileName(key)).catch(() => null);
    if (text !== null && text.length > 0) {
      storage.setItem(key, text);
      restored.push(key);
    }
  }
  return restored;
}
