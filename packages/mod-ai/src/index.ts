/** @pattern-js/mod-ai — public surface (the AI capability layer). */

export { aiMod } from "./mod.js";
export { default } from "./mod.js";

export { AI_PROVIDER_SERVICE, AI_CATALOG_SERVICE, AI_CONFIG_SERVICE } from "./well-known.js";
export { ProviderService, type AiProviderService } from "./provider.js";
export { ModelCatalog, type ModelCatalogService } from "./catalog.js";
export { ModelServiceImpl } from "./model-service-impl.js";
export { McpService } from "./mcp.js";
export { aiOps } from "./ops/index.js";
export {
  mediaRefSchema,
  genProgressSchema,
  modelCapabilitySchema,
  modelRefSchema,
  type MediaRef,
  type GenProgress,
  type ModelCapability,
  type ModelRef,
} from "./types.js";
