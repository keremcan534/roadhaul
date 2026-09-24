import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { KeyValueStorage } from '../../core/storage/KeyValueStorage';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { SaveGameData } from '../../domain/save/SaveGameData';
import { migrateSave, type SaveMigrationContext } from '../../domain/save/saveMigrations';
import { validateSaveGameData } from '../../domain/save/validateSaveGameData';

/** Storage keys. The main slot holds the latest save, the backup the one before it. */
export const SAVE_KEYS = Object.freeze({
  main: 'roadhaul.save',
  backup: 'roadhaul.save.backup',
  /** A new save is written and read back here before it replaces the main slot. */
  pending: 'roadhaul.save.pending',
  /** A save that could not be loaded is kept here, so a bug report can include it. */
  unreadable: 'roadhaul.save.unreadable',
});

/**
 * missing: no save yet (a new player). corrupted: neither slot could be read
 * or validated. tooNew: written by a newer build; it is left untouched.
 */
export type LoadProblem = 'missing' | 'corrupted' | 'tooNew';
export type SaveProblem = 'invalid' | 'storageFailed';

export interface SaveServiceOptions {
  readonly migration: SaveMigrationContext;
  /** Highest company level a save may hold (the length of GameConfig.company.levelXp). */
  readonly maxCompanyLevel: number;
}

/**
 * Versioned local saves (spec §32, §52; roadmap step 18). JSON in a
 * key-value store (localStorage in the browser):
 *
 * - **Atomic write:** the new save goes to a pending slot and is read back;
 *   only then does the old save move to the backup slot and the new one into
 *   the main slot. A failure part-way leaves a readable save behind.
 * - **Backup:** loading falls back to the previous save when the latest is
 *   unreadable.
 * - **Corruption:** unparsable or invalid data never reaches the game. It is
 *   set aside and reported, and the player can start over.
 * - **Migrations:** older versions are upgraded on load (saveMigrations.ts).
 *
 * The game must never crash because of save data: storage errors come back
 * as Results too.
 */
export class SaveService {
  constructor(
    private readonly storage: KeyValueStorage,
    private readonly content: ContentCatalog,
    private readonly options: SaveServiceOptions,
    private readonly logger: Logger,
  ) {}

  /** Whether there is something to continue from (it may still turn out unreadable). */
  hasSave(): boolean {
    return this.read(SAVE_KEYS.main) !== null || this.read(SAVE_KEYS.backup) !== null;
  }

  load(): Result<SaveGameData, LoadProblem> {
    let found = false;
    for (const key of [SAVE_KEYS.main, SAVE_KEYS.backup]) {
      const json = this.read(key);
      if (json === null) {
        continue;
      }
      found = true;
      const loaded = this.parse(json);
      if (loaded.ok) {
        if (key === SAVE_KEYS.backup) {
          this.logger.warn('The latest save was unreadable; continuing from the backup.');
        }
        return loaded;
      }
      if (loaded.error === 'tooNew') {
        this.logger.warn(`The save in ${key} comes from a newer version of the game; it was left untouched.`);
        return err('tooNew');
      }
      this.logger.warn(`The save in ${key} is unreadable.`);
    }
    if (!found) {
      return err('missing');
    }
    this.setAsideUnreadable();
    return err('corrupted');
  }

  /** Writes `save` atomically and keeps the previous save as the backup. */
  save(save: SaveGameData): Result<void, SaveProblem> {
    const issues = validateSaveGameData(save, this.content, this.options.maxCompanyLevel);
    if (issues.length > 0) {
      // Our own state is broken: keep the last good save rather than overwrite it.
      this.logger.error(`Refusing to write an invalid save: ${issues.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`);
      return err('invalid');
    }
    const json = JSON.stringify(save);
    try {
      this.storage.setItem(SAVE_KEYS.pending, json);
      if (this.storage.getItem(SAVE_KEYS.pending) !== json) {
        throw new Error('The written save did not read back the same.');
      }
      const previous = this.storage.getItem(SAVE_KEYS.main);
      if (previous !== null && this.parse(previous).ok) {
        this.storage.setItem(SAVE_KEYS.backup, previous);
      }
      this.storage.setItem(SAVE_KEYS.main, json);
      this.storage.removeItem(SAVE_KEYS.pending);
      return ok(undefined);
    } catch (error) {
      this.logger.error('Saving failed.', error);
      return err('storageFailed');
    }
  }

  /** Removes every save slot: a fresh start. */
  deleteAll(): void {
    for (const key of Object.values(SAVE_KEYS)) {
      try {
        this.storage.removeItem(key);
      } catch (error) {
        this.logger.warn(`Could not remove ${key}.`, error);
      }
    }
  }

  private parse(json: string): Result<SaveGameData, 'unreadable' | 'tooNew'> {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return err('unreadable');
    }
    const migrated = migrateSave(raw, this.options.migration);
    if (!migrated.ok) {
      return err(migrated.error === 'tooNew' ? 'tooNew' : 'unreadable');
    }
    const issues = validateSaveGameData(migrated.value, this.content, this.options.maxCompanyLevel);
    if (issues.length > 0) {
      this.logger.warn(`Save data is invalid: ${issues.slice(0, 5).map((issue) => issue.path).join(', ')}`);
      return err('unreadable');
    }
    return ok(migrated.value as unknown as SaveGameData);
  }

  private read(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch (error) {
      this.logger.warn(`Could not read ${key}.`, error);
      return null;
    }
  }

  /** Keeps the unreadable main save aside for bug reports and clears the slots, so the next save starts clean. */
  private setAsideUnreadable(): void {
    try {
      const unreadable = this.storage.getItem(SAVE_KEYS.main) ?? this.storage.getItem(SAVE_KEYS.backup);
      if (unreadable !== null) {
        this.storage.setItem(SAVE_KEYS.unreadable, unreadable);
      }
      this.storage.removeItem(SAVE_KEYS.main);
      this.storage.removeItem(SAVE_KEYS.backup);
    } catch (error) {
      this.logger.warn('Could not set the unreadable save aside.', error);
    }
  }
}
