/**
 * @pattern-js/mod-billing — the admin surface (Tier-1 declarative, zero build).
 *
 * One Billing page under System, three sections: the accounts form (driver
 * select + sourced secrets — same contract as the Email page: refs only,
 * never values), the customers table (the user ↔ provider mapping the
 * webhooks maintain, entitlement at a glance), and recent events (what the
 * provider actually delivered — the first place to look when a subscription
 * "didn't stick").
 */

import { fromBody, fromParams, httpEndpoint, required, value, z, type FrontendContribution, type OpContext, type OpDefinition, type Workflow } from "@pattern-js/core";
import { DEFAULT_ACCOUNT } from "./config.js";
import { REMOTE } from "./app.js";
import { billingAccountSchema } from "./types.js";
import { billingConfig, billingService } from "./ops.js";
import { CUSTOMERS_COLLECTION, EVENTS_COLLECTION } from "./service.js";
import { docsStore } from "./well-known.js";

const API = "/admin/api";
const STATUS_PATH = "/billing/api/status";
const ACCOUNTS_PATH = "/billing/api/accounts";
const PROVIDERS_PATH = "/billing/api/providers";
const CUSTOMERS_PATH = "/billing/api/customers";
const EVENTS_PATH = "/billing/api/events";

/* ── ops behind the page (privileged; the routes carry the admin gate) ── */

const providersList: OpDefinition = {
  type: "billing.providers.list",
  effects: "pure",
  title: "billing.providers.list",
  description: "List the registered billing drivers + their secret/option field specs (drives the account form).",
  reusable: false,
  config: z.object({}),
  inputs: {},
  outputs: { providers: value() },
  execute: (ctx) => ({ providers: billingService(ctx).drivers() }),
};

const accountFields = {
  name: required(z.string()),
  provider: required(z.string()),
  secrets: value(z.unknown()),
  options: value(z.unknown()),
};

/** The Tier-1 form posts secrets/options as JSON STRINGS; a workflow passes objects. */
function jsonObject(raw: unknown, what: string): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  const s = String(raw).trim();
  if (!s) return {};
  try {
    const parsed = JSON.parse(s) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* fall through to the located error */
  }
  throw new Error(`${what} must be a JSON object, e.g. {"apiKey":{"source":"env","key":"STRIPE_API_KEY"}} — got: ${s.slice(0, 60)}`);
}

async function readAccountFields(ctx: OpContext) {
  const [name, provider, secrets, options] = await Promise.all([
    ctx.input.value<string>("name"),
    ctx.input.value<string>("provider"),
    ctx.input.has("secrets") ? ctx.input.value("secrets") : undefined,
    ctx.input.has("options") ? ctx.input.value("options") : undefined,
  ]);
  return billingAccountSchema.parse({
    name,
    provider,
    secrets: jsonObject(secrets, "secrets"),
    options: jsonObject(options, "options"),
  });
}

const accountsRead: OpDefinition = {
  type: "billing.accounts.read",
  effects: "pure",
  title: "billing.accounts.read",
  description: "List the configured billing accounts (secret NAMES/sources only, never values).",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: {},
  outputs: { accounts: value() },
  execute: (ctx) => ({ accounts: billingConfig(ctx).accounts() }),
};

const accountsWrite: OpDefinition = {
  type: "billing.accounts.write",
  effects: "idempotent",
  title: "billing.accounts.write",
  description: "Create or update a billing account (upsert by name).",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: accountFields,
  outputs: { result: value() },
  execute: async (ctx) => {
    const account = await readAccountFields(ctx);
    await billingConfig(ctx).upsertAccount(account);
    return { result: { ok: true, name: account.name } };
  },
};

const accountsDelete: OpDefinition = {
  type: "billing.accounts.delete",
  effects: "idempotent",
  title: "billing.accounts.delete",
  description: "Delete a billing account by name.",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: { name: required(z.string()) },
  outputs: { result: value() },
  execute: async (ctx) => {
    await billingConfig(ctx).deleteAccount(await ctx.input.value<string>("name"));
    return { result: { ok: true } };
  },
};


/**
 * The setup checklist's data: how far this installation is from its first
 * subscription — driver, account, secrets, price, webhook, and the last event
 * actually received (the feedback loop for `stripe listen`).
 */
const adminStatus: OpDefinition = {
  type: "billing.admin.status",
  effects: "pure",
  title: "billing.admin.status",
  description: "Billing setup status for the admin checklist: driver/account/secrets/price/webhook state + the last ingested event.",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: {},
  outputs: { status: value() },
  execute: async (ctx) => {
    const drivers = billingService(ctx).drivers();
    const accounts = billingConfig(ctx).accounts();
    const account = accounts.find((a) => a.name === DEFAULT_ACCOUNT) ?? accounts[0];
    const driver = account ? drivers.find((d) => d.id === account.provider) : drivers[0];
    const requiredSecrets = (driver?.secrets ?? []).filter((f) => f.required !== false).map((f) => f.field);
    const missingSecrets = requiredSecrets.filter((f) => !account?.secrets?.[f]);
    const webhookFields = (driver?.secrets ?? []).map((f) => f.field).filter((f) => /webhook/i.test(f));
    const hasWebhookSecret = webhookFields.some((f) => Boolean(account?.secrets?.[f]));
    const origin = (ctx.env.PATTERN_PUBLIC_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
    const provider = account?.provider ?? driver?.id ?? "stripe";
    let lastEvent: { kind: unknown; at: unknown } | null = null;
    const store = docsStore(ctx);
    if (store) {
      const rows = await store.docs
        .query({ collection: EVENTS_COLLECTION, orderBy: "createdAt", orderDir: "desc", limit: 1 })
        .catch(() => []);
      const d = rows[0]?.data as Record<string, unknown> | undefined;
      if (d) lastEvent = { kind: d.kind, at: d.at };
    }
    return {
      status: {
        drivers: drivers.map((d) => ({ id: d.id, label: d.label })),
        account: account
          ? {
              name: account.name,
              provider: account.provider,
              missingSecrets,
              hasWebhookSecret,
              defaultPriceKey: account.options?.defaultPriceKey ?? "",
            }
          : null,
        webhookUrl: `${origin}/billing/webhook/${provider}`,
        publicUrlSet: Boolean(ctx.env.PATTERN_PUBLIC_URL?.trim()),
        lastEvent,
      },
    };
  },
};

const customersList: OpDefinition = {
  type: "billing.customers.list",
  effects: "pure",
  title: "billing.customers.list",
  description: "The user ↔ provider-customer mapping the webhooks maintain: status, prices, entitlement (admin).",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: {},
  outputs: { customers: value() },
  execute: async (ctx) => {
    const store = docsStore(ctx);
    if (!store) return { customers: [] };
    const rows = await store.docs
      .query({ collection: CUSTOMERS_COLLECTION, orderBy: "updatedAt", orderDir: "desc", limit: 200 })
      .catch(() => []);
    return {
      customers: rows.map((r) => {
        const d = r.data as Record<string, unknown>;
        return {
          userId: d.userId ?? "—",
          customerId: d.customerId,
          provider: d.provider,
          status: d.status ?? "—",
          priceKeys: Array.isArray(d.priceKeys) ? (d.priceKeys as string[]).join(", ") : "—",
          entitled: d.entitled ? "yes" : "no",
          updatedAt: d.updatedAt ? new Date(d.updatedAt as number).toISOString() : "",
        };
      }),
    };
  },
};

const eventsList: OpDefinition = {
  type: "billing.events.list",
  effects: "pure",
  title: "billing.events.list",
  description: "Recently ingested (verified + deduped) provider events, newest first (admin).",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: {},
  outputs: { events: value() },
  execute: async (ctx) => {
    const store = docsStore(ctx);
    if (!store) return { events: [] };
    const rows = await store.docs
      .query({ collection: EVENTS_COLLECTION, orderBy: "createdAt", orderDir: "desc", limit: 100 })
      .catch(() => []);
    return {
      events: rows.map((r) => {
        const d = r.data as Record<string, unknown>;
        return {
          eventId: d.eventId,
          kind: d.kind,
          provider: d.provider,
          account: d.account,
          at: d.at ? new Date(d.at as number).toISOString() : "",
        };
      }),
    };
  },
};

export const adminOps: OpDefinition[] = [providersList, adminStatus, accountsRead, accountsWrite, accountsDelete, customersList, eventsList];

export function billingAdminRoutes(): Workflow[] {
  const auth = { scopes: ["admin"] };
  const accountIn = { name: fromBody(), provider: fromBody(), secrets: fromBody(), options: fromBody() };
  return [
    httpEndpoint({ id: "billing.route.providers", name: `Billing · GET ${API}${PROVIDERS_PATH}`, method: "GET", path: `${API}${PROVIDERS_PATH}`, op: "billing.providers.list", io: { out: "providers" }, auth }),
    httpEndpoint({ id: "billing.route.status", name: `Billing · GET ${API}${STATUS_PATH}`, method: "GET", path: `${API}${STATUS_PATH}`, op: "billing.admin.status", io: { out: "status" }, auth }),
    httpEndpoint({ id: "billing.route.accounts.read", name: `Billing · GET ${API}${ACCOUNTS_PATH}`, method: "GET", path: `${API}${ACCOUNTS_PATH}`, op: "billing.accounts.read", io: { out: "accounts" }, auth }),
    httpEndpoint({ id: "billing.route.accounts.write", name: `Billing · POST ${API}${ACCOUNTS_PATH}`, method: "POST", path: `${API}${ACCOUNTS_PATH}`, op: "billing.accounts.write", io: { in: accountIn, out: "result" }, auth }),
    httpEndpoint({ id: "billing.route.accounts.delete", name: `Billing · DELETE ${API}${ACCOUNTS_PATH}/:name`, method: "DELETE", path: `${API}${ACCOUNTS_PATH}/:name`, op: "billing.accounts.delete", io: { in: { name: fromParams() }, out: "result" }, auth }),
    httpEndpoint({ id: "billing.route.customers", name: `Billing · GET ${API}${CUSTOMERS_PATH}`, method: "GET", path: `${API}${CUSTOMERS_PATH}`, op: "billing.customers.list", io: { out: "customers" }, auth }),
    httpEndpoint({ id: "billing.route.events", name: `Billing · GET ${API}${EVENTS_PATH}`, method: "GET", path: `${API}${EVENTS_PATH}`, op: "billing.events.list", io: { out: "events" }, auth }),
  ];
}

export function billingFrontend(): FrontendContribution {
  return {
    menu: [{ category: "System", label: "Billing", icon: "credit-card", path: "/x/billing", order: 22 }],
    // The Tier-2 page is just its source; the admin serves + imports it. It owns
    // the setup checklist, driver-spec-driven editable accounts (per-field
    // secret refs), and the customers/events tables.
    pages: [{ path: "/x/billing", title: "Billing", module: REMOTE }],
  };
}
