import { describe, expect, it } from 'vitest';
import { ContentCatalog } from '../../../../src/data/ContentCatalog';
import { GAME_CONTENT } from '../../../../src/data/content';
import { levelUnlocks } from '../../../../src/ui/menus/levelUnlocks';

describe('levelUnlocks', () => {
  const content = ContentCatalog.create(GAME_CONTENT);

  it('opens a new region with the ferry\'s level, before everything else it opens', () => {
    const unlocks = levelUnlocks(content, 2);
    expect(unlocks[0]).toEqual({ kind: 'regions', count: 1 });
    expect(unlocks.length).toBeGreaterThan(1);
  });

  it('opens no region at the other levels', () => {
    for (const level of [1, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(levelUnlocks(content, level).some((unlock) => unlock.kind === 'regions'), `level ${level}`).toBe(false);
    }
  });
});
