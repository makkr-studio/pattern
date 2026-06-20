/**
 * @pattern-js/mod-identity — keyed in-process mutex.
 *
 * Serializes read-modify-write cycles per key (session id, user id) so a
 * single instance doesn't burn CAS retries against itself. Same promise-chain
 * pattern as the admin store's per-slug locks. Multi-instance correctness is
 * the store's CAS clause, not this.
 */

export class KeyedMutex {
  private locks = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((r) => (release = r));
    this.locks.set(key, current);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      // Drop the entry once no later caller has replaced it.
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }
}
