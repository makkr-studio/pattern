/**
 * @pattern-js/mod-ai — the mod.
 *
 * The capability layer: registers the modality ops and provides the four
 * services the rest of the system meets it through — the provider (ModelRef →
 * SDK model), the model catalog, the neutral model service the agent loop calls
 * (AI_MODEL_SERVICE, from mod-agents), and the MCP seam. This is the only mod
 * that imports the Vercel AI SDK.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { localFs, provideFilesystem } from "@pattern-js/runtime-node";
import { defineMod, type Engine, type PatternMod } from "@pattern-js/core";
import { AI_MCP_SERVICE, AI_MODEL_SERVICE } from "@pattern-js/mod-agents";
import { AI_CATALOG_SERVICE, AI_CONFIG_SERVICE, AI_PROVIDER_SERVICE } from "./well-known.js";
import { ProviderService } from "./provider.js";
import { ModelServiceImpl } from "./model-service-impl.js";
import { ModelCatalog } from "./catalog.js";
import { McpService } from "./mcp.js";
import { AiConfigService } from "./config.js";
import { aiOps } from "./ops/index.js";
import { aiAdminRoutes, aiFrontend, settingsOps } from "./settings.js";
import { mcpServeOp, mcpServerWorkflow } from "./mcp-server.js";
import { aiAppMount, provideAiAssets } from "./app.js";

function packagedDocs(engine: Engine): void {
  try {
    const dir = fileURLToPath(new URL("../docs", import.meta.url));
    if (existsSync(dir)) provideFilesystem(engine, "ai-docs", localFs(dir));
  } catch {
    /* packaged without docs — the contribution is simply skipped */
  }
}

export function aiMod(): PatternMod {
  const config = new AiConfigService();
  return defineMod({
    name: "@pattern-js/mod-ai",
    docs: { filesystem: "ai-docs", title: "AI", order: 51 },
    ops: [...aiOps, ...settingsOps, mcpServeOp],
    workflows: [...aiAdminRoutes(), mcpServerWorkflow(), aiAppMount],
    frontend: aiFrontend(),
    setup: (engine: Engine) => {
      packagedDocs(engine);
      provideAiAssets(engine);
      const provider = new ProviderService((id) => config.connection(id));
      engine.provideService(AI_PROVIDER_SERVICE, provider);
      engine.provideService(AI_CATALOG_SERVICE, new ModelCatalog());
      engine.provideService(AI_CONFIG_SERVICE, config);
      // The model service falls back to the configured default when no ai.model is wired.
      engine.provideService(AI_MODEL_SERVICE, new ModelServiceImpl(provider, () => config.defaultModel()));
      engine.provideService(AI_MCP_SERVICE, new McpService());
    },
    ready: async () => {
      await config.load();
    },
  });
}

/** A ready-to-use AI capabilities mod (for `loadMods`/`engine.use`). */
export default aiMod();
