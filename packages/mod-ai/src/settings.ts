/**
 * @pattern-js/mod-ai — the control-plane ops + admin routes behind the
 * AI Providers page.
 *
 * Two persisted concepts (see config.ts): CONNECTIONS (how to reach a provider —
 * structured options + vault secret NAMES chosen explicitly) and ALIASES
 * (memorable names → a connection + model id). Provider KEYS themselves live in
 * mod-vault's Secrets screen; here we list providers, manage connections and
 * aliases, list the model catalog, and test a connection. All admin-scoped.
 */

import {
  fromBody,
  fromParams,
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
import { aliasSchema, connectionSchema, type ModelCapability } from "./types.js";
import type { AiConfigService } from "./config.js";
import { fromGatewayModel, type ModelCatalogService } from "./catalog.js";
import { listProviders, type AiProviderService } from "./provider.js";
import { maybe } from "./ops/shared.js";

function configSvc(ctx: OpContext): AiConfigService {
  const svc = ctx.services[AI_CONFIG_SERVICE] as AiConfigService | undefined;
  if (!svc) throw new Error("mod-ai: config service missing — install @pattern-js/mod-ai.");
  return svc;
}

// ───────────────────────────── Providers ──────────────────────────────

const providersList: OpDefinition = {
  type: "ai.providers.list",
  title: "ai.providers.list",
  description: "List the supported providers + their credential/option fields (drives the connection form).",
  reusable: false,
  config: z.object({}),
  inputs: {},
  outputs: { providers: value() },
  execute: () => ({ providers: listProviders() }),
};

// ──────────────────────────── Connections ─────────────────────────────

const connectionsRead: OpDefinition = {
  type: "ai.connections.read",
  title: "ai.connections.read",
  description: "List configured provider connections (secret NAMES only, never values).",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: {},
  outputs: { connections: value() },
  execute: (ctx) => ({ connections: configSvc(ctx).connections() }),
};

const connectionWrite: OpDefinition = {
  type: "ai.connections.write",
  title: "ai.connections.write",
  description: "Create or update a provider connection (upsert by id).",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: {
    id: required(z.string()),
    provider: required(z.string()),
    routing: value(z.string()),
    label: value(z.string()),
    secrets: value(z.record(z.string(), z.string())),
    options: value(z.record(z.string(), z.string())),
  },
  outputs: { result: value() },
  execute: async (ctx) => {
    const [id, provider, routing, label, secrets, options] = await Promise.all([
      ctx.input.value<string>("id"),
      ctx.input.value<string>("provider"),
      maybe<string>(ctx, "routing"),
      maybe<string>(ctx, "label"),
      maybe<Record<string, string>>(ctx, "secrets"),
      maybe<Record<string, string>>(ctx, "options"),
    ]);
    const conn = connectionSchema.parse({
      id,
      label,
      provider,
      routing: routing === "gateway" ? "gateway" : "direct",
      secrets: secrets ?? {},
      options: options ?? {},
    });
    await configSvc(ctx).upsertConnection(conn);
    return { result: { ok: true, id } };
  },
};

const connectionDelete: OpDefinition = {
  type: "ai.connections.delete",
  title: "ai.connections.delete",
  description: "Delete a provider connection by id.",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: { id: required(z.string()) },
  outputs: { result: value() },
  execute: async (ctx) => {
    await configSvc(ctx).deleteConnection(await ctx.input.value<string>("id"));
    return { result: { ok: true } };
  },
};

// ────────────────────────────── Aliases ───────────────────────────────

const aliasesRead: OpDefinition = {
  type: "ai.aliases.read",
  title: "ai.aliases.read",
  description: "List the configured model aliases.",
  reusable: false,
  config: z.object({}),
  inputs: {},
  outputs: { aliases: value() },
  execute: (ctx) => ({ aliases: configSvc(ctx).aliases() }),
};

const aliasWrite: OpDefinition = {
  type: "ai.aliases.write",
  title: "ai.aliases.write",
  description: "Create or update a model alias (upsert by name).",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: {
    name: required(z.string()),
    connection: required(z.string()),
    modelId: required(z.string()),
    modality: value(z.string()),
  },
  outputs: { result: value() },
  execute: async (ctx) => {
    const [name, connection, modelId, modality] = await Promise.all([
      ctx.input.value<string>("name"),
      ctx.input.value<string>("connection"),
      ctx.input.value<string>("modelId"),
      maybe<string>(ctx, "modality"),
    ]);
    const alias = aliasSchema.parse({ name, connection, modelId, modality: modality || "language" });
    await configSvc(ctx).upsertAlias(alias);
    return { result: { ok: true, name } };
  },
};

const aliasDelete: OpDefinition = {
  type: "ai.aliases.delete",
  title: "ai.aliases.delete",
  description: "Delete a model alias by name.",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: { name: required(z.string()) },
  outputs: { result: value() },
  execute: async (ctx) => {
    await configSvc(ctx).deleteAlias(await ctx.input.value<string>("name"));
    return { result: { ok: true } };
  },
};

// ─────────────────────────── Catalog + test ───────────────────────────

const modelsList: OpDefinition = {
  type: "ai.models.list",
  title: "ai.models.list",
  description: "List the model catalog (static baseline + live gateway listing) for the settings UI.",
  reusable: false,
  config: z.object({}),
  inputs: {},
  outputs: { models: value() },
  execute: async (ctx) => {
    const catalog = ctx.services[AI_CATALOG_SERVICE] as ModelCatalogService | undefined;
    const provider = ctx.services[AI_PROVIDER_SERVICE] as AiProviderService | undefined;
    const stat = catalog ? await catalog.list() : [];
    let live: ModelCapability[] = [];
    if (provider) {
      try {
        const raw = await provider.gatewayModels(ctx);
        live = raw.map(fromGatewayModel).filter((m): m is ModelCapability => m != null);
      } catch {
        /* keep the static baseline if the gateway is unreachable */
      }
    }
    const seen = new Set(stat.map((m) => `${m.routing}:${m.id}`));
    return { models: [...stat, ...live.filter((m) => !seen.has(`${m.routing}:${m.id}`))] };
  },
};

const connectionTest: OpDefinition = {
  type: "ai.connection.test",
  title: "ai.connection.test",
  description: "Test a connection/model: resolves keys + builds the model, reporting { ok, detail }.",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: {
    connection: value(z.string()),
    routing: value(z.string()),
    provider: value(z.string()),
    modelId: value(z.string()),
    modality: value(z.string()),
  },
  outputs: { result: value() },
  execute: async (ctx) => {
    const provider = ctx.services[AI_PROVIDER_SERVICE] as AiProviderService | undefined;
    if (!provider) return { result: { ok: false, detail: "provider service missing" } };
    const [connection, routing, prov, modelId, modality] = await Promise.all([
      maybe<string>(ctx, "connection"),
      maybe<string>(ctx, "routing"),
      maybe<string>(ctx, "provider"),
      maybe<string>(ctx, "modelId"),
      maybe<string>(ctx, "modality"),
    ]);
    const ref = modelRefSchema.parse({
      kind: "model",
      routing: routing === "gateway" ? "gateway" : "direct",
      modality: modality || "language",
      provider: prov ?? "",
      modelId: modelId ?? "test",
      connection: connection || undefined,
    });
    return { result: await provider.testConnection(ref, ctx) };
  },
};

export const settingsOps: OpDefinition[] = [
  providersList,
  connectionsRead,
  connectionWrite,
  connectionDelete,
  aliasesRead,
  aliasWrite,
  aliasDelete,
  modelsList,
  connectionTest,
];

const API = "/admin/api";

export function aiAdminRoutes(): Workflow[] {
  const auth = { scopes: ["admin"] };
  return [
    httpEndpoint({ id: "ai.route.providers", name: `AI · GET ${API}/ai/providers`, method: "GET", path: `${API}/ai/providers`, op: "ai.providers.list", io: { out: "providers" }, auth }),
    httpEndpoint({ id: "ai.route.connections.read", name: `AI · GET ${API}/ai/connections`, method: "GET", path: `${API}/ai/connections`, op: "ai.connections.read", io: { out: "connections" }, auth }),
    httpEndpoint({
      id: "ai.route.connections.write",
      name: `AI · POST ${API}/ai/connections`,
      method: "POST",
      path: `${API}/ai/connections`,
      op: "ai.connections.write",
      io: { in: { id: fromBody(), provider: fromBody(), routing: fromBody(), label: fromBody(), secrets: fromBody(), options: fromBody() }, out: "result" },
      auth,
    }),
    httpEndpoint({ id: "ai.route.connections.delete", name: `AI · DELETE ${API}/ai/connections/:id`, method: "DELETE", path: `${API}/ai/connections/:id`, op: "ai.connections.delete", io: { in: { id: fromParams() }, out: "result" }, auth }),
    httpEndpoint({ id: "ai.route.aliases.read", name: `AI · GET ${API}/ai/aliases`, method: "GET", path: `${API}/ai/aliases`, op: "ai.aliases.read", io: { out: "aliases" }, auth }),
    httpEndpoint({
      id: "ai.route.aliases.write",
      name: `AI · POST ${API}/ai/aliases`,
      method: "POST",
      path: `${API}/ai/aliases`,
      op: "ai.aliases.write",
      io: { in: { name: fromBody(), connection: fromBody(), modelId: fromBody(), modality: fromBody() }, out: "result" },
      auth,
    }),
    httpEndpoint({ id: "ai.route.aliases.delete", name: `AI · DELETE ${API}/ai/aliases/:name`, method: "DELETE", path: `${API}/ai/aliases/:name`, op: "ai.aliases.delete", io: { in: { name: fromParams() }, out: "result" }, auth }),
    httpEndpoint({ id: "ai.route.models", name: `AI · GET ${API}/ai/models`, method: "GET", path: `${API}/ai/models`, op: "ai.models.list", io: { out: "models" }, auth }),
    httpEndpoint({
      id: "ai.route.test",
      name: `AI · POST ${API}/ai/test`,
      method: "POST",
      path: `${API}/ai/test`,
      op: "ai.connection.test",
      io: { in: { connection: fromBody(), routing: fromBody(), provider: fromBody(), modelId: fromBody(), modality: fromBody() }, out: "result" },
      auth,
    }),
  ];
}

export function aiFrontend(): FrontendContribution {
  return {
    menu: [{ category: "System", label: "AI Providers", icon: "bot", path: "/x/ai/providers", order: 20 }],
    pages: [
      {
        path: "/x/ai/providers",
        remote: "/ai-ext/ai-providers.js",
        title: "AI Providers",
        subtitle: "Connections (providers + vault keys) and model aliases agents & chat resolve at run time.",
      },
    ],
  };
}
