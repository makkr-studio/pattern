/**
 * @pattern-js/mod-ai — the control-plane ops + admin routes behind the
 * AI Providers page.
 *
 * One persisted concept (see config.ts): ALIASES — memorable names, each a
 * fully self-contained model (provider + model id + sourced secrets + structured
 * options). Provider KEYS themselves live in mod-vault's Secrets screen (or env
 * vars); here we list the supported providers + their field specs, manage
 * aliases, list the model catalog, and test an alias. All admin-scoped.
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
import { AI_CATALOG_SERVICE, AI_CONFIG_SERVICE, AI_PROVIDER_SERVICE } from "./well-known.js";
import { aliasSchema, type ModelCapability } from "./types.js";
import type { AiConfigService } from "./config.js";
import { fromGatewayModel, type ModelCatalogService } from "./catalog.js";
import { listProviders, type AiProviderService } from "./provider.js";
import { ASSETS, ASSETS_MOUNT } from "./app.js";
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
  description: "List the supported providers + their secret/option field specs (drives the alias form).",
  reusable: false,
  config: z.object({}),
  inputs: {},
  outputs: { providers: value() },
  execute: () => ({ providers: listProviders() }),
};

// ────────────────────────────── Aliases ───────────────────────────────

const aliasesRead: OpDefinition = {
  type: "ai.aliases.read",
  title: "ai.aliases.read",
  description: "List the configured model aliases (secret NAMES/sources only, never values).",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: {},
  outputs: { aliases: value() },
  execute: (ctx) => ({ aliases: configSvc(ctx).aliases() }),
};

/** Build + validate an Alias from the loose body fields the form sends. */
function aliasFromBody(fields: {
  name: string;
  provider: string;
  modelId: string;
  modality?: string;
  secrets?: Record<string, { source?: string; key?: string }>;
  options?: Record<string, string>;
}) {
  return aliasSchema.parse({
    name: fields.name,
    provider: fields.provider,
    modelId: fields.modelId,
    modality: fields.modality || "language",
    secrets: fields.secrets ?? {},
    options: fields.options ?? {},
  });
}

const aliasFields = {
  name: required(z.string()),
  provider: required(z.string()),
  modelId: required(z.string()),
  modality: value(z.string()),
  secrets: value(z.record(z.string(), z.record(z.string(), z.string()))),
  options: value(z.record(z.string(), z.string())),
};

async function readAliasFields(ctx: OpContext) {
  const [name, provider, modelId, modality, secrets, options] = await Promise.all([
    ctx.input.value<string>("name"),
    ctx.input.value<string>("provider"),
    ctx.input.value<string>("modelId"),
    maybe<string>(ctx, "modality"),
    maybe<Record<string, { source?: string; key?: string }>>(ctx, "secrets"),
    maybe<Record<string, string>>(ctx, "options"),
  ]);
  return { name, provider, modelId, modality, secrets, options };
}

const aliasWrite: OpDefinition = {
  type: "ai.aliases.write",
  title: "ai.aliases.write",
  description: "Create or update a model alias (upsert by name).",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: aliasFields,
  outputs: { result: value() },
  execute: async (ctx) => {
    const alias = aliasFromBody(await readAliasFields(ctx));
    await configSvc(ctx).upsertAlias(alias);
    return { result: { ok: true, name: alias.name } };
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
  description: "List the model catalog (static suggestions + live gateway listing) for the settings UI.",
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
        /* keep the static suggestions if the gateway is unreachable */
      }
    }
    const seen = new Set(stat.map((m) => `${m.routing}:${m.id}`));
    return { models: [...stat, ...live.filter((m) => !seen.has(`${m.routing}:${m.id}`))] };
  },
};

const aliasTest: OpDefinition = {
  type: "ai.alias.test",
  title: "ai.alias.test",
  description: "Test an alias draft: resolves its secrets + builds the provider, reporting { ok, detail }.",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: aliasFields,
  outputs: { result: value() },
  execute: async (ctx) => {
    const provider = ctx.services[AI_PROVIDER_SERVICE] as AiProviderService | undefined;
    if (!provider) return { result: { ok: false, detail: "provider service missing" } };
    const alias = aliasFromBody(await readAliasFields(ctx));
    return { result: await provider.testAlias(alias, ctx) };
  },
};

export const settingsOps: OpDefinition[] = [providersList, aliasesRead, aliasWrite, aliasDelete, modelsList, aliasTest];

const API = "/admin/api";

export function aiAdminRoutes(): Workflow[] {
  const auth = { scopes: ["admin"] };
  const aliasIn = { name: fromBody(), provider: fromBody(), modelId: fromBody(), modality: fromBody(), secrets: fromBody(), options: fromBody() };
  return [
    httpEndpoint({ id: "ai.route.providers", name: `AI · GET ${API}/ai/providers`, method: "GET", path: `${API}/ai/providers`, op: "ai.providers.list", io: { out: "providers" }, auth }),
    httpEndpoint({ id: "ai.route.aliases.read", name: `AI · GET ${API}/ai/aliases`, method: "GET", path: `${API}/ai/aliases`, op: "ai.aliases.read", io: { out: "aliases" }, auth }),
    httpEndpoint({ id: "ai.route.aliases.write", name: `AI · POST ${API}/ai/aliases`, method: "POST", path: `${API}/ai/aliases`, op: "ai.aliases.write", io: { in: aliasIn, out: "result" }, auth }),
    httpEndpoint({ id: "ai.route.aliases.delete", name: `AI · DELETE ${API}/ai/aliases/:name`, method: "DELETE", path: `${API}/ai/aliases/:name`, op: "ai.aliases.delete", io: { in: { name: fromParams() }, out: "result" }, auth }),
    httpEndpoint({ id: "ai.route.models", name: `AI · GET ${API}/ai/models`, method: "GET", path: `${API}/ai/models`, op: "ai.models.list", io: { out: "models" }, auth }),
    httpEndpoint({ id: "ai.route.test", name: `AI · POST ${API}/ai/test`, method: "POST", path: `${API}/ai/test`, op: "ai.alias.test", io: { in: aliasIn, out: "result" }, auth }),
  ];
}

export function aiFrontend(): FrontendContribution {
  return {
    // The Tier-2 page bundle is served declaratively by the host (no app workflow).
    mounts: [{ filesystem: ASSETS, mount: ASSETS_MOUNT }],
    menu: [{ category: "System", label: "AI Providers", icon: "bot", path: "/x/ai/providers", order: 20 }],
    pages: [
      {
        path: "/x/ai/providers",
        remote: `${ASSETS_MOUNT}/ai-providers.js`,
        title: "AI Providers",
      },
    ],
  };
}
