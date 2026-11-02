/**
 * What the game is to do as it starts again (a reload): take the company on
 * in the region it travelled to, or found the new company the player named
 * in the starting region. Kept in the tab's session storage for one start.
 */
export interface PendingBoot {
  /** The region (map id) to build, over the saved company's. */
  readonly mapId?: string;
  /** Continue the saved company at once (it has just travelled). */
  readonly continueCompany?: boolean;
  /** The region (map id) the company is crossing to: the crossing shows while this start builds it. */
  readonly crossingTo?: string;
  /** Found this company at once, starting at `startId`. */
  readonly newCompany?: { readonly name: string; readonly startId: string };
}

const KEY = 'roadhaul.pendingBoot';

/** Takes what the last page asked this start to do (once: it is removed). Null when nothing, or unreadable. */
export function takePendingBoot(storage: Pick<Storage, 'getItem' | 'removeItem'> | null): PendingBoot | null {
  try {
    const text = storage?.getItem(KEY) ?? null;
    storage?.removeItem(KEY);
    if (text === null) {
      return null;
    }
    const value = JSON.parse(text) as unknown;
    return typeof value === 'object' && value !== null ? (value as PendingBoot) : null;
  } catch {
    return null;
  }
}

/** Asks the next start to do `boot`. False when the tab cannot keep it (no session storage). */
export function leavePendingBoot(storage: Pick<Storage, 'setItem'> | null, boot: PendingBoot): boolean {
  try {
    storage?.setItem(KEY, JSON.stringify(boot));
    return storage !== null;
  } catch {
    return false;
  }
}

/** The tab's session storage, or null where the browser forbids it. */
export function sessionStorageOf(window: Window): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
