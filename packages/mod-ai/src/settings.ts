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
  value,
  z,
  type FrontendContribution,
  type OpContext,
  type OpDefinition,
  type Workflow,
} from "@pattern-js/core";
import { modelRefSchema } from "@pattern-js/mod-agents";
import { AI_CATALOG_SERVICE, AI_CONFIG_SERVICE } from "./well-known.js";
import type { AiConfigService } from "./config.js";
import type { ModelCatalogService } from "./catalog.js";
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

export const settingsOps: OpDefinition[] = [settingsRead, settingsWrite, modelsList];

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
  ];
}

export function aiFrontend(): FrontendContribution {
  return {
    settings: [
      {
        id: "ai",
        title: "AI Providers",
        description:
          "The default model agents and chat use when no ai.model node is wired. Provider keys live in the vault (System → Secrets).",
        route: { method: "GET", path: `${API}/ai/settings` },
        submitRoute: { method: "POST", path: `${API}/ai/settings` },
        fields: [
          {
            key: "defaultRouting",
            label: "Routing",
            type: "select",
            options: [
              { value: "gateway", label: "Vercel AI Gateway" },
              { value: "direct", label: "Direct provider" },
            ],
          },
          { key: "defaultProvider", label: "Provider", type: "text", description: 'direct: "openai" · gateway: provider half of the id' },
          { key: "defaultModelId", label: "Model id", type: "text", description: 'direct: "gpt-5" · gateway: "openai/gpt-5"' },
        ],
      },
    ],
  };
}
