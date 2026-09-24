/**
 * Company progression (spec §14). `levelXp[i]` is the XP at which level i + 1
 * starts, so it begins with 0 for level 1 and rises strictly (GameConfig
 * validates it). The MVP has five levels.
 */

/** The company level reached with `xp`. */
export function levelForXp(xp: number, levelXp: readonly number[]): number {
  let level = 1;
  for (let i = 1; i < levelXp.length; i++) {
    if (xp >= levelXp[i]!) {
      level = i + 1;
    }
  }
  return level;
}

export interface LevelProgress {
  readonly level: number;
  /** XP earned since the current level started. */
  readonly xpIntoLevel: number;
  /** XP the current level spans; null at the top level. */
  readonly xpForLevel: number | null;
  /** How far through the current level, 0..1 (1 at the top level). */
  readonly fraction: number;
}

export function levelProgress(xp: number, levelXp: readonly number[]): LevelProgress {
  const level = levelForXp(xp, levelXp);
  const start = levelXp[level - 1] ?? 0;
  const next = levelXp[level];
  if (next === undefined) {
    return { level, xpIntoLevel: xp - start, xpForLevel: null, fraction: 1 };
  }
  return { level, xpIntoLevel: xp - start, xpForLevel: next - start, fraction: (xp - start) / (next - start) };
}
