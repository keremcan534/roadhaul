/**
 * Persistent string storage: the shape of the Web Storage API, so the
 * browser's localStorage fits as is (platform layer) and tests use
 * MemoryStorage. Any call may throw (quota exceeded, storage disabled in a
 * private window); callers must handle that.
 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory storage for tests and for browsers without working localStorage. */
export class MemoryStorage implements KeyValueStorage {
  private readonly items = new Map<string, string>();

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, String(value));
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  /** Every stored key, for tests. */
  keys(): string[] {
    return [...this.items.keys()];
  }
}
