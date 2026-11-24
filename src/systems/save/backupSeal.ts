import { err, ok, type Result } from '../../core/Result';
import { hmacSha256Hex } from '../../core/hash/sha256';

/** What a backup file says it is. */
const BACKUP_KIND = 'roadhaul-backup';
/** The backup file's layout: 2 is the save with a seal over it (format 1, before it, was the bare save). */
export const BACKUP_FORMAT = 2;

/**
 * The key the seal is made with. It ships inside the game, so the seal stops a save edited by hand (a player
 * adding credits in a text editor, as a review on Google Play told everyone how to), not someone who reads the
 * game's code: with no server, there is nowhere to keep a real secret. Changing it refuses every backup made before.
 */
const SEAL_KEY = 'roadhaul-backup:bzlUodgjqYPzLe8I5mZBcYx8CVTo57en';

/**
 * unreadable: not a backup at all. unsealed: a bare save (an older version's backup, or one put together by hand)
 * or a sealed one changed since. tooNew: a layout from a newer version of the game.
 */
export type BackupOpenProblem = 'unreadable' | 'unsealed' | 'tooNew';

function sealOf(saveJson: string): string {
  return hmacSha256Hex(SEAL_KEY, saveJson);
}

/** A backup file's text for `save`: the save as JSON, with a seal over it. */
export function sealBackup(save: unknown): string {
  const saveJson = JSON.stringify(save);
  return `{"kind":"${BACKUP_KIND}","format":${BACKUP_FORMAT},"seal":"${sealOf(saveJson)}","save":${saveJson}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The save JSON a backup file holds, if its seal still matches it. The seal is over the save as JSON.stringify
 * writes it, so a backup only reformatted (indented, its spacing changed) still opens; one with any value changed
 * does not.
 */
export function openBackup(text: string): Result<string, BackupOpenProblem> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return err('unreadable');
  }
  if (!isRecord(parsed)) {
    return err('unreadable');
  }
  if (parsed['kind'] !== BACKUP_KIND) {
    // A bare save (it has a version) is an older backup or a made-up one; anything else is no backup.
    return err(typeof parsed['version'] === 'number' ? 'unsealed' : 'unreadable');
  }
  const format = parsed['format'];
  if (typeof format !== 'number') {
    return err('unreadable');
  }
  if (format > BACKUP_FORMAT) {
    return err('tooNew');
  }
  const seal = parsed['seal'];
  if (format !== BACKUP_FORMAT || typeof seal !== 'string' || !isRecord(parsed['save'])) {
    return err('unsealed');
  }
  const saveJson = JSON.stringify(parsed['save']);
  return sealOf(saveJson) === seal.toLowerCase() ? ok(saveJson) : err('unsealed');
}
