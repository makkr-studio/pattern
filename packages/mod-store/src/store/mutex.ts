/**
 * Promise-chain mutex per key (lifted from mod-identity). Serializes work on
 * a single node to trim redundant CAS retries; cross-instance correctness is
 * always the CAS clause's job.
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
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }
}
