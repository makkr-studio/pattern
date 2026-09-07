/**
 * @pattern-js/mod-billing — the admin surface (Tier-1 declarative, zero build).
 *
 * One Billing page under Administration: the setup checklist, the accounts
 * form (driver select + sourced secrets — same contract as the Email page:
 * refs only, never values), the customers table (the user ↔ provider mapping
 * the webhooks maintain — subscription state, entitlement, and what was
 * bought outright), one-time purchases, and recent events (what the provider
 * actually delivered — the first place to look when a subscription "didn't
 * stick").
 */

import { fromBody, fromParams, httpEndpoint, required, value, z, type ChecklistStep, type FrontendContribution, type OpContext, type OpDefinition, type Workflow } from "@pattern-js/core";
import { DEFAULT_ACCOUNT } from "./config.js";
import { REMOTE } from "./app.js";
import { billingAccountSchema } from "./types.js";
import { billingConfig, billingService } from "./ops.js";
import { CUSTOMERS_COLLECTION, EVENTS_COLLECTION } from "./service.js";
import { docsStore } from "./well-known.js";

const API = "/admin/api";
const STATUS_PATH = "/billing/api/status";
const CHECKLIST_PATH = "/billing/api/checklist";
const ACCOUNTS_PATH = "/billing/api/accounts";
const PROVIDERS_PATH = "/billing/api/providers";
const CUSTOMERS_PATH = "/billing/api/customers";
const EVENTS_PATH = "/billing/api/events";
const PURCHASES_PATH = "/billing/api/purchases";

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
  // A partial write — `secrets` / `options` not wired or not in the body —
  // keeps what the account already has: an omitted field must never wipe a
  // secret ref. An explicit `{}` is how you clear one.
  const existing = billingConfig(ctx).account(name);
  return billingAccountSchema.parse({
    name,
    provider,
    secrets: secrets === undefined ? (existing?.secrets ?? {}) : jsonObject(secrets, "secrets"),
    options: options === undefined ? (existing?.options ?? {}) : jsonObject(options, "options"),
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


/** The status snapshot both admin ops read: driver/account/secrets/price/webhook + last event. */
async function computeStatus(ctx: OpContext) {
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
    drivers: drivers.map((d) => ({ id: d.id, label: d.label })),
    account: account
      ? {
          name: account.name,
          provider: account.provider,
          missingSecrets,
          hasWebhookSecret,
          defaultPriceKey: (account.options?.defaultPriceKey ?? "") as string,
        }
      : null,
    webhookUrl: `${origin}/billing/webhook/${provider}`,
    publicUrlSet: Boolean(ctx.env.PATTERN_PUBLIC_URL?.trim()),
    lastEvent,
  };
}

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
  execute: async (ctx) => ({ status: await computeStatus(ctx) }),
};

function agoOf(at: unknown): string {
  const ts = typeof at === "number" ? at : Number(at);
  if (!Number.isFinite(ts)) return "";
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/**
 * The checklist itself, server-computed — steps AND their next-action copy
 * live once, next to the state they report on. The billing page and the
 * dashboard's "open for business" board both render exactly this.
 */
const adminChecklist: OpDefinition = {
  type: "billing.admin.checklist",
  effects: "pure",
  title: "billing.admin.checklist",
  description:
    "The billing setup checklist, normalized: { steps: [{ ok, label, how?, detail? }], done, note? }. " +
    "Rendered by the Billing page and aggregated by the admin dashboard.",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: {},
  outputs: { checklist: value() },
  execute: async (ctx) => {
    const st = await computeStatus(ctx);
    const a = st.account;
    const steps: ChecklistStep[] = [
      {
        ok: st.drivers.length > 0,
        label: "A billing driver is installed",
        how: "Install one and list it in pattern.config.json — e.g. @pattern-js/mod-billing-stripe (or run: pattern add billing).",
      },
      {
        ok: Boolean(a),
        label: "An account exists",
        how: 'Save the account form (admin → Administration → Billing) as "default" — the ops and the starter workflows fall back to it.',
      },
      {
        ok: Boolean(a) && a!.missingSecrets.length === 0,
        label: "API key connected",
        how: "Stripe dashboard (TEST mode) → Developers → API keys: paste sk_test_… into admin → Resources → Secrets as STRIPE_API_KEY (encrypted, no restart), then set the account's apiKey to vault / STRIPE_API_KEY.",
      },
      {
        ok: Boolean(a?.defaultPriceKey),
        label: "A price to sell",
        how: "Stripe dashboard (TEST mode) → Product catalog: create a product with a price — recurring for a subscription, one-time for a purchase — and give it a lookup key (e.g. pro, lifetime). Put that key (or the price_… id) in the account's Default price field; a checkout node can name any other price with priceKey.",
      },
      {
        ok: Boolean(a?.hasWebhookSecret),
        label: "Webhook secret set",
        how: `Run: stripe listen --forward-to ${st.webhookUrl}  — paste the printed whsec_… into admin → Resources → Secrets as STRIPE_WEBHOOK_SECRET and set the account's webhookSecret to vault / STRIPE_WEBHOOK_SECRET.`,
      },
      {
        ok: Boolean(st.lastEvent),
        label: "First event received",
        how: "Subscribe (or buy) on your landing page with the test card 4242 4242 4242 4242 (any future date/CVC) — or fire one with: stripe trigger checkout.session.completed.",
        detail: st.lastEvent ? `${String(st.lastEvent.kind)} · ${agoOf(st.lastEvent.at)}` : undefined,
      },
    ];
    return {
      checklist: {
        steps,
        done: steps.every((s) => s.ok),
        note: st.publicUrlSet
          ? undefined
          : "Behind a proxy or deployed? Set PATTERN_PUBLIC_URL so checkout redirects and the webhook URL use your real origin.",
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
          // Prices bought outright (one-time) — kept for good.
          purchased: Array.isArray(d.purchased) && (d.purchased as string[]).length ? (d.purchased as string[]).join(", ") : "—",
          updatedAt: d.updatedAt ? new Date(d.updatedAt as number).toISOString() : "",
        };
      }),
    };
  },
};

const purchasesList: OpDefinition = {
  type: "billing.purchases.list",
  effects: "pure",
  title: "billing.purchases.list",
  description: "Recorded one-time purchases (payment-mode checkouts), newest first: who bought what, for how much (admin).",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: {},
  outputs: { purchases: value() },
  execute: async (ctx) => {
    const rows = await billingService(ctx).purchases({ limit: 200 }, ctx);
    return {
      purchases: rows.map((p) => ({
        userId: p.userId ?? "—",
        customerId: p.customerId ?? "—",
        priceKeys: p.priceKeys.join(", ") || "—",
        quantity: p.quantity,
        amount: p.amount,
        currency: p.currency,
        sessionId: p.sessionId ?? p.eventId,
        provider: p.provider,
        account: p.account,
        at: new Date(p.at).toISOString(),
      })),
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
          // Delivery state: processed | processing | failed (rows from before
          // states existed count as processed — the semantics they had).
          status: (d.status as string | undefined) ?? "processed",
          attempts: (d.attempts as number | undefined) ?? 1,
          provider: d.provider,
          account: d.account,
          at: d.at ? new Date(d.at as number).toISOString() : "",
          error: d.error,
        };
      }),
    };
  },
};

export const adminOps: OpDefinition[] = [providersList, adminStatus, adminChecklist, accountsRead, accountsWrite, accountsDelete, customersList, purchasesList, eventsList];

export function billingAdminRoutes(): Workflow[] {
  const auth = { scopes: ["admin"] };
  const accountIn = { name: fromBody(), provider: fromBody(), secrets: fromBody(), options: fromBody() };
  return [
    httpEndpoint({ id: "billing.route.providers", name: `Billing · GET ${API}${PROVIDERS_PATH}`, method: "GET", path: `${API}${PROVIDERS_PATH}`, op: "billing.providers.list", io: { out: "providers" }, auth }),
    httpEndpoint({ id: "billing.route.status", name: `Billing · GET ${API}${STATUS_PATH}`, method: "GET", path: `${API}${STATUS_PATH}`, op: "billing.admin.status", io: { out: "status" }, auth }),
    httpEndpoint({ id: "billing.route.checklist", name: `Billing · GET ${API}${CHECKLIST_PATH}`, method: "GET", path: `${API}${CHECKLIST_PATH}`, op: "billing.admin.checklist", io: { out: "checklist" }, auth }),
    httpEndpoint({ id: "billing.route.accounts.read", name: `Billing · GET ${API}${ACCOUNTS_PATH}`, method: "GET", path: `${API}${ACCOUNTS_PATH}`, op: "billing.accounts.read", io: { out: "accounts" }, auth }),
    httpEndpoint({ id: "billing.route.accounts.write", name: `Billing · POST ${API}${ACCOUNTS_PATH}`, method: "POST", path: `${API}${ACCOUNTS_PATH}`, op: "billing.accounts.write", io: { in: accountIn, out: "result" }, auth }),
    httpEndpoint({ id: "billing.route.accounts.delete", name: `Billing · DELETE ${API}${ACCOUNTS_PATH}/:name`, method: "DELETE", path: `${API}${ACCOUNTS_PATH}/:name`, op: "billing.accounts.delete", io: { in: { name: fromParams() }, out: "result" }, auth }),
    httpEndpoint({ id: "billing.route.customers", name: `Billing · GET ${API}${CUSTOMERS_PATH}`, method: "GET", path: `${API}${CUSTOMERS_PATH}`, op: "billing.customers.list", io: { out: "customers" }, auth }),
    httpEndpoint({ id: "billing.route.purchases", name: `Billing · GET ${API}${PURCHASES_PATH}`, method: "GET", path: `${API}${PURCHASES_PATH}`, op: "billing.purchases.list", io: { out: "purchases" }, auth }),
    httpEndpoint({ id: "billing.route.events", name: `Billing · GET ${API}${EVENTS_PATH}`, method: "GET", path: `${API}${EVENTS_PATH}`, op: "billing.events.list", io: { out: "events" }, auth }),
  ];
}

export function billingFrontend(): FrontendContribution {
  return {
    menu: [{ category: "Administration", label: "Billing", icon: "credit-card", path: "/x/billing", order: 50 }],
    // The Tier-2 page is just its source; the admin serves + imports it. It owns
    // the setup checklist, driver-spec-driven editable accounts (per-field
    // secret refs), and the customers/events tables.
    pages: [{ path: "/x/billing", title: "Billing", module: REMOTE }],
    // The dashboard aggregates this into the "open for business" board.
    checklists: [{ id: "billing", title: "From zero to your first payment", route: { path: CHECKLIST_PATH } }],
  };
}
