/**
 * @pattern-js/mod-ai — the AI settings screen (default model) + its routes.
 *
 * The provider KEYS are managed by mod-vault's Secrets screen; here we set the
 * DEFAULT model agents/chat fall back to. A declarative SettingsSection renders
 * the form; admin-scope-gated routes back it. (A richer Tier-2 capability matrix
 * + test-connection page is a tracked follow-up.)
 */

import {
  fromBody,
  httpEndpoint,
  required,
  value,
  z,
  type FrontendContribution,
  type OpContext,
  type OpDefinition,
  type Workflow,
} from "@pattern-js/core";
import { modelRefSchema } from "@pattern-js/mod-agents";
import { AI_CATALOG_SERVICE, AI_CONFIG_SERVICE, AI_PROVIDER_SERVICE } from "./well-known.js";
import type { AiConfigService } from "./config.js";
import type { ModelCatalogService } from "./catalog.js";
import type { AiProviderService } from "./provider.js";
import { maybe } from "./ops/shared.js";

function configSvc(ctx: OpContext): AiConfigService {
  const svc = ctx.services[AI_CONFIG_SERVICE] as AiConfigService | undefined;
  if (!svc) throw new Error("mod-ai: config service missing — install @pattern-js/mod-ai.");
  return svc;
}

const flatSchema = z.object({
  defaultRouting: z.string(),
  defaultProvider: z.string(),
  defaultModelId: z.string(),
});

const settingsRead: OpDefinition = {
  type: "ai.settings.read",
  title: "ai.settings.read",
  description: "Read the AI settings (the default model), flattened for the settings form.",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: {},
  outputs: { settings: value(flatSchema) },
  execute: (ctx) => {
    const dm = configSvc(ctx).defaultModel();
    return {
      settings: {
        defaultRouting: dm?.routing ?? "gateway",
        defaultProvider: dm?.provider ?? "",
        defaultModelId: dm?.modelId ?? "",
      },
    };
  },
};

const settingsWrite: OpDefinition = {
  type: "ai.settings.write",
  title: "ai.settings.write",
  description: "Set the default model (routing + provider + model id). Empty provider/model clears it.",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: {
    defaultRouting: value(z.string()),
    defaultProvider: value(z.string()),
    defaultModelId: value(z.string()),
  },
  outputs: { result: value() },
  execute: async (ctx) => {
    const [routing, provider, modelId] = await Promise.all([
      maybe<string>(ctx, "defaultRouting"),
      maybe<string>(ctx, "defaultProvider"),
      maybe<string>(ctx, "defaultModelId"),
    ]);
    const defaultModel =
      provider && modelId
        ? modelRefSchema.parse({
            kind: "model",
            routing: routing === "direct" ? "direct" : "gateway",
            modality: "language",
            provider,
            modelId,
          })
        : undefined;
    await configSvc(ctx).set({ defaultModel });
    return { result: { ok: true } };
  },
};

const modelsList: OpDefinition = {
  type: "ai.models.list",
  title: "ai.models.list",
  description: "List the model catalog (static baseline + gateway) for the settings UI.",
  reusable: false,
  config: z.object({}),
  inputs: {},
  outputs: { models: value() },
  execute: async (ctx) => {
    const catalog = ctx.services[AI_CATALOG_SERVICE] as ModelCatalogService | undefined;
    return { models: catalog ? await catalog.list() : [] };
  },
};

const providerTest: OpDefinition = {
  type: "ai.provider.test",
  title: "ai.provider.test",
  description: "Test a provider/model: resolves the key + builds the model, reporting { ok, detail }.",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: {
    routing: value(z.string()),
    provider: required(z.string()),
    modelId: required(z.string()),
    modality: value(z.string()),
  },
  outputs: { result: value() },
  execute: async (ctx) => {
    const provider = ctx.services[AI_PROVIDER_SERVICE] as AiProviderService | undefined;
    if (!provider) return { result: { ok: false, detail: "provider service missing" } };
    const [routing, prov, modelId, modality] = await Promise.all([
      maybe<string>(ctx, "routing"),
      ctx.input.value<string>("provider"),
      ctx.input.value<string>("modelId"),
      maybe<string>(ctx, "modality"),
    ]);
    const ref = modelRefSchema.parse({
      kind: "model",
      routing: routing === "direct" ? "direct" : "gateway",
      modality: modality ?? "language",
      provider: prov,
      modelId,
    });
    return { result: await provider.testConnection(ref, ctx) };
  },
};

export const settingsOps: OpDefinition[] = [settingsRead, settingsWrite, modelsList, providerTest];

const API = "/admin/api";

export function aiAdminRoutes(): Workflow[] {
  const auth = { scopes: ["admin"] };
  return [
    httpEndpoint({
      id: "ai.route.settings.read",
      name: `AI · GET ${API}/ai/settings`,
      method: "GET",
      path: `${API}/ai/settings`,
      op: "ai.settings.read",
      io: { out: "settings" },
      auth,
    }),
    httpEndpoint({
      id: "ai.route.settings.write",
      name: `AI · POST ${API}/ai/settings`,
      method: "POST",
      path: `${API}/ai/settings`,
      op: "ai.settings.write",
      io: { in: { defaultRouting: fromBody(), defaultProvider: fromBody(), defaultModelId: fromBody() }, out: "result" },
      auth,
    }),
    httpEndpoint({
      id: "ai.route.models",
      name: `AI · GET ${API}/ai/models`,
      method: "GET",
      path: `${API}/ai/models`,
      op: "ai.models.list",
      io: { out: "models" },
      auth,
    }),
    httpEndpoint({
      id: "ai.route.test",
      name: `AI · POST ${API}/ai/test`,
      method: "POST",
      path: `${API}/ai/test`,
      op: "ai.provider.test",
      io: { in: { routing: fromBody(), provider: fromBody(), modelId: fromBody(), modality: fromBody() }, out: "result" },
      auth,
    }),
  ];
}

export function aiFrontend(): FrontendContribution {
  return {
    // The richer Tier-2 page (default model + Test connection + catalog matrix).
    menu: [{ category: "System", label: "AI Providers", icon: "bot", path: "/x/ai/providers", order: 20 }],
    pages: [{ path: "/x/ai/providers", remote: "/ai-ext/ai-providers.js" }],
  };
}
