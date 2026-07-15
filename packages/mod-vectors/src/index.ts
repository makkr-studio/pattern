/** @pattern-js/mod-vectors — public surface (vector search for Pattern). */

export { vectorsMod, type VectorsOptions } from "./mod.js";
export { default } from "./mod.js";

export { DefaultVectorsService, VECTORS_SERVICE, type VectorsService } from "./service.js";
export { LocalVectorsEngine, normalize, rrfFuse, type LocalEngineOptions } from "./engine-local.js";
export { chunkText, chunkDoc, type Chunk, type ChunkOptions } from "./chunk.js";
export { vectorsOps } from "./ops.js";
export {
  collectionSpecSchema,
  filterSchema,
  queryModeSchema,
  vectorItemSchema,
  type CollectionInfo,
  type CollectionSpec,
  type EngineQuery,
  type EngineRow,
  type Filter,
  type FilterValue,
  type Match,
  type QueryMode,
  type VectorItem,
  type VectorsEngine,
} from "./types.js";
