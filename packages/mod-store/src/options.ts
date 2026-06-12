/**
 * @pattern/mod-store — options & defaults. Bare-string installs get sensible
 * defaults; custom setups use a local wrapper mod exporting `storeMod({...})`.
 */

export interface StoreOptions {
  /**
   * SQLite database path, or "memory" for the in-process store. Default
   * "./.pattern-data/store.db" — gitignored; NEVER `.pattern/` (committed).
   */
  storage?: string;
  /** Directory for blob bytes. Default "./.pattern-data/blobs". */
  blobDir?: string;
  /** Max blob size in bytes. Default 25 MiB. */
  maxBlobBytes?: number;
  /**
   * Serve blobs over HTTP at GET /store/blobs/:id. Default true (ids are
   * unguessable UUIDs). Pass `{ requireAuth: ... }` to gate the route, or
   * false to not register it.
   */
  blobRoute?: boolean | { requireAuth?: unknown };
}

export interface ResolvedStoreOptions {
  storage: string;
  blobDir: string;
  maxBlobBytes: number;
  blobRoute: false | { requireAuth?: unknown };
}

export function resolveOptions(options: StoreOptions = {}): ResolvedStoreOptions {
  const blobRoute = options.blobRoute ?? true;
  return {
    storage: options.storage ?? "./.pattern-data/store.db",
    blobDir: options.blobDir ?? "./.pattern-data/blobs",
    maxBlobBytes: options.maxBlobBytes ?? 25 * 1024 * 1024,
    blobRoute: blobRoute === true ? {} : blobRoute,
  };
}
