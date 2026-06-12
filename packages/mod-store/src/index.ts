/**
 * @pattern/mod-store — public surface.
 *
 * `storeMod(options)` is the brick; the contracts + STORE_SERVICE are the
 * seam other mods (chat, agents…) build on.
 */

export { storeMod } from "./mod.js";
export { default } from "./mod.js";

export { resolveOptions, type StoreOptions, type ResolvedStoreOptions } from "./options.js";
export { STORE_SERVICE, storeService } from "./well-known.js";
export { storeOps } from "./ops.js";
export { storeFrontend } from "./frontend.js";
export { blobServeWorkflow } from "./workflows.js";
export { memoryPatternStores } from "./store/memory.js";
export { sqlitePatternStores } from "./store/sqlite.js";
export { KeyedMutex } from "./store/mutex.js";
export { bufferStream } from "./store/bytes.js";
export {
  indexValue,
  valueAtPath,
  type AcquireResult,
  type BlobMeta,
  type BlobStore,
  type CollectionDef,
  type DocumentRow,
  type DocumentStore,
  type LeaseRow,
  type LeaseStore,
  type PatternStores,
  type QueryOptions,
} from "./store/types.js";
