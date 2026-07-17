/**
 * @pattern-js/mod-billing — the canvas ops + the billing.event trigger.
 *
 * Checkout and the portal return URLS — wiring one into
 * `boundary.http.response`'s redirect is the whole payment UI. Entitlement is
 * a fast mapping read (`billing.entitled`), never a provider round-trip;
 * `billing.subscription.get` is the provider-fresh sibling. The trigger rides
 * core's generic trigger seam, so "on payment failed → email the user" is an
 * ordinary workflow.
 */

import { httpOutcome, value, z, type OpContext, type OpDefinition } from "@pattern-js/core";
import { BILLING_EVENT_KINDS, BillingNoCustomerError, BillingNotConfiguredError, billingAccountRefSchema } from "./types.js";
import { DEFAULT_ACCOUNT, type BillingConfigService } from "./config.js";
import { BILLING_CONFIG_SERVICE, BILLING_SERVICE } from "./well-known.js";
import type { BillingService } from "./service.js";

export async function maybe<T>(ctx: OpContext, port: string): Promise<T | undefined> {
  return ctx.input.has(port) ? ((await ctx.input.value(port)) as T) : undefined;
}

export function billingService(ctx: OpContext): BillingService {
  const svc = ctx.services[BILLING_SERVICE] as BillingService | undefined;
  if (!svc) throw new Error("mod-billing: billing service missing — install @pattern-js/mod-billing.");
  return svc;
}

export function billingConfig(ctx: OpContext): BillingConfigService {
  const svc = ctx.services[BILLING_CONFIG_SERVICE] as BillingConfigService | undefined;
  if (!svc) throw new Error("mod-billing: billing config missing — install @pattern-js/mod-billing.");
  return svc;
}

/* ── account ref (the email.account sibling) ──────────────────────────── */

export const accountOp: OpDefinition = {
  type: "billing.account",
  effects: "pure",
  title: "billing.account",
  description:
    "Resolve a named billing account (configured in admin → System → Billing) to an account reference. " +
    'Defaults to "default". With required=false it probes instead of throwing: `configured` reports ' +
    "whether the account exists.",
  config: z.object({
    account: z.string().min(1).default(DEFAULT_ACCOUNT),
    required: z.boolean().default(true),
  }),
  configInputs: { account: value(z.string()) },
  inputs: {},
  outputs: {
    account: value(billingAccountRefSchema.nullable()),
    configured: value(z.boolean()),
  },
  execute: async (ctx) => {
    const cfg = ctx.config as { account: string; required: boolean };
    const name = (await maybe<string>(ctx, "account")) ?? cfg.account;
    const ref = billingConfig(ctx).resolveAccount(name);
    if (!ref && cfg.required) {
      throw new Error(`billing.account: no account "${name}" is configured — add it in admin → System → Billing.`);
    }
    return { account: ref ?? null, configured: Boolean(ref) };
  },
};

/* ── checkout / portal ────────────────────────────────────────────────── */

/**
 * Setup-shaped failures become a friendly OUTCOME on `result` (409 via
 * boundary.http.status) instead of a failed run: an unconfigured demo is a
 * to-do with a pointer, not an error page — and no failure alert fires.
 */
function unavailableOutcome(err: unknown): Record<string, unknown> | null {
  if (err instanceof BillingNotConfiguredError) {
    return httpOutcome("conflict", {
      error: "billing_not_configured",
      message: err.message,
      setup: "/admin",
    });
  }
  if (err instanceof BillingNoCustomerError) {
    return httpOutcome("conflict", { error: "billing_no_customer", message: err.message });
  }
  return null;
}

/** The provider retry seal, pinned to this run+node — a retried attempt replays, never repeats. */
const retrySeal = (ctx: OpContext): string => `${ctx.runId}:${ctx.nodeId}`;

export const checkoutCreateOp: OpDefinition = {
  type: "billing.checkout.create",
  // Idempotent by construction: the provider idempotency key is pinned to the
  // run+node, so repeating with the same inputs replays the SAME session
  // (Stripe stores idempotent POSTs ≥24h). A per-node retry converges; resume
  // never re-runs a completed node; a FRESH run means a fresh key on purpose.
  effects: "idempotent",
  title: "billing.checkout.create",
  description:
    "Create a hosted checkout session — redirect the browser to `url` and the provider handles cards, taxes, " +
    "and 3DS. `userId` becomes the checkout's reference, so the completion webhook maps the new customer back " +
    "to your user. `origin` (wire the trigger's request URL or leave it — PATTERN_PUBLIC_URL wins) anchors the " +
    "success/cancel redirects; priceKey falls back to the account's defaultPriceKey. Retries are provider-side " +
    "idempotent (the key is pinned to the run+node). `result` carries { url, sessionId } — or, when billing " +
    "isn't set up yet, a friendly conflict outcome for boundary.http.status; `url` stays for happy-path wiring.",
  config: z.object({
    account: z.string().default(DEFAULT_ACCOUNT),
    mode: z.enum(["subscription", "payment"]).default("subscription"),
  }),
  inputs: {
    userId: value(z.string().optional()),
    email: value(z.string().optional()),
    priceKey: value(z.string().optional()),
    quantity: value(z.number().optional()),
    origin: value(z.string().optional()),
    idempotencyKey: value(z.string().optional()),
  },
  outputs: { result: value(), url: value(z.string().optional()), sessionId: value(z.string().optional()) },
  execute: async (ctx) => {
    const cfg = ctx.config as { account: string; mode: "subscription" | "payment" };
    try {
      const res = await billingService(ctx).checkout(
        {
          account: cfg.account,
          mode: cfg.mode,
          userId: await maybe<string>(ctx, "userId"),
          email: await maybe<string>(ctx, "email"),
          priceKey: await maybe<string>(ctx, "priceKey"),
          quantity: await maybe<number>(ctx, "quantity"),
          origin: originOf(await maybe<string>(ctx, "origin")),
          idempotencyKey: (await maybe<string>(ctx, "idempotencyKey")) ?? retrySeal(ctx),
        },
        ctx,
      );
      return { result: { url: res.url, sessionId: res.sessionId }, url: res.url, sessionId: res.sessionId };
    } catch (err) {
      const outcome = unavailableOutcome(err);
      if (outcome) return { result: outcome, url: undefined, sessionId: undefined };
      throw err;
    }
  },
};

export const portalCreateOp: OpDefinition = {
  type: "billing.portal.create",
  // Same construction as checkout.create: the run+node-pinned provider key
  // makes a retried attempt replay the same portal session.
  effects: "idempotent",
  title: "billing.portal.create",
  description:
    "Create a customer-portal session for `userId`'s provider customer — the provider's own UI for upgrades, " +
    "cancellation, invoices and payment methods. Needs an existing customer (a completed checkout): before one " +
    "exists, `result` carries a friendly conflict outcome for boundary.http.status (subscribe first) instead of " +
    "failing the run; `url` stays for happy-path wiring. Retries are provider-side idempotent.",
  config: z.object({ account: z.string().default(DEFAULT_ACCOUNT) }),
  inputs: {
    userId: value(z.string()),
    origin: value(z.string().optional()),
    idempotencyKey: value(z.string().optional()),
  },
  outputs: { result: value(), url: value(z.string().optional()) },
  execute: async (ctx) => {
    const cfg = ctx.config as { account: string };
    const userId = (await ctx.input.value<string>("userId")) ?? "";
    if (!userId) throw new Error("billing.portal.create: `userId` is required (wire the trigger's user.id).");
    try {
      const res = await billingService(ctx).portal(
        {
          account: cfg.account,
          userId,
          origin: originOf(await maybe<string>(ctx, "origin")),
          idempotencyKey: (await maybe<string>(ctx, "idempotencyKey")) ?? retrySeal(ctx),
        },
        ctx,
      );
      return { result: res, url: res.url };
    } catch (err) {
      const outcome = unavailableOutcome(err);
      if (outcome) return { result: outcome, url: undefined };
      throw err;
    }
  },
};

/** Accept a full request URL (the fromRequestUrl port) or a bare origin. */
function originOf(v: string | undefined): string | undefined {
  if (!v) return undefined;
  try {
    return new URL(v).origin;
  } catch {
    return v;
  }
}

/* ── state reads ──────────────────────────────────────────────────────── */

export const subscriptionGetOp: OpDefinition = {
  type: "billing.subscription.get",
  effects: "pure",
  title: "billing.subscription.get",
  description:
    "The user's subscription, provider-fresh: { status, entitled, priceKeys, customerId }. Asks the payment " +
    "provider when a subscription exists (falling back to the local mapping if unreachable). For hot-path " +
    "gating use billing.entitled — it never leaves the process.",
  config: z.object({ account: z.string().default(DEFAULT_ACCOUNT) }),
  inputs: { userId: value(z.string()) },
  outputs: { subscription: value() },
  execute: async (ctx) => {
    const cfg = ctx.config as { account: string };
    const userId = (await ctx.input.value<string>("userId")) ?? "";
    if (!userId) throw new Error("billing.subscription.get: `userId` is required.");
    return { subscription: await billingService(ctx).subscription({ account: cfg.account, userId }, ctx) };
  },
};

export const entitledOp: OpDefinition = {
  type: "billing.entitled",
  effects: "pure",
  title: "billing.entitled",
  description:
    "Fast entitlement check: { entitled, status } straight from the local customer mapping (updated by every " +
    "webhook) — no provider round-trip, safe on every request. Wire `entitled` into core.flow.branch to gate " +
    "a paid path mid-graph; route-level gating stays requireAuth + the projected role.",
  inputs: { userId: value(z.string()) },
  outputs: { entitled: value(z.boolean()), status: value(z.string().optional()) },
  execute: async (ctx) => {
    const userId = (await ctx.input.value<string>("userId")) ?? "";
    if (!userId) return { entitled: false, status: undefined };
    const res = await billingService(ctx).entitled({ userId }, ctx);
    return { entitled: res.entitled, status: res.status };
  },
};

/* ── usage metering ───────────────────────────────────────────────────── */

export const usageRecordOp: OpDefinition = {
  type: "billing.usage.record",
  effects: "external",
  title: "billing.usage.record",
  description:
    "Record a metered-usage event: `value` units on `meter` (the provider meter's event name) against the " +
    "user's billing customer (or an explicit customerId). Pass a stable `identifier` to make retries " +
    "provider-side idempotent. Invoices aggregate the meter automatically at period end.",
  config: z.object({ account: z.string().default(DEFAULT_ACCOUNT), meter: z.string().optional() }),
  inputs: {
    userId: value(z.string().optional()),
    customerId: value(z.string().optional()),
    meter: value(z.string().optional()),
    value: value(z.number()),
    identifier: value(z.string().optional()),
  },
  outputs: { result: value() },
  execute: async (ctx) => {
    const cfg = ctx.config as { account: string; meter?: string };
    const meter = (await maybe<string>(ctx, "meter")) ?? cfg.meter;
    if (!meter) throw new Error("billing.usage.record: name the `meter` (config or input).");
    const amount = await ctx.input.value<number>("value");
    if (typeof amount !== "number" || !Number.isFinite(amount)) {
      throw new Error("billing.usage.record: `value` must be a finite number of units.");
    }
    const result = await billingService(ctx).recordUsage(
      {
        account: cfg.account,
        userId: await maybe<string>(ctx, "userId"),
        customerId: await maybe<string>(ctx, "customerId"),
        meter,
        value: amount,
        // Default the provider dedup key to the run+node seal, so a retried
        // node can never double-count usage.
        identifier: (await maybe<string>(ctx, "identifier")) ?? retrySeal(ctx),
      },
      ctx,
    );
    return { result };
  },
};

/* ── the trigger ──────────────────────────────────────────────────────── */

export const billingEventTrigger: OpDefinition = {
  type: "billing.event",
  title: "billing.event",
  description:
    "Billing event trigger: fires once per normalized provider event (checkout completed, subscription " +
    "updated/deleted, invoice paid/failed) after verification, dedup and role projection. config.kind narrows " +
    "to one kind (empty = all five). Outputs { event, kind, account, userId? } — build \"payment failed → " +
    "email the user\" as an ordinary workflow.",
  boundary: "trigger",
  pair: "boundary.return",
  // The provider's webhook delivery never reads this run's result.
  outgateOptional: true,
  triggerEvents: (config: { kind?: string }) => {
    const kinds = config.kind?.trim() ? [config.kind.trim()] : BILLING_EVENT_KINDS;
    return kinds.map((kind) => ({
      event: `billing.${kind}`,
      map: (payload: unknown) => {
        const p = payload as { event?: { kind?: string; userRef?: string }; account?: string };
        return {
          event: p.event,
          kind: p.event?.kind,
          account: p.account,
          userId: p.event && "userRef" in p.event ? p.event.userRef : undefined,
        };
      },
    }));
  },
  inputs: {},
  configInputs: { kind: value(z.string()) },
  outputs: {
    event: value(),
    kind: value(z.string()),
    account: value(z.string()),
    userId: value(z.string().optional()),
  },
  config: z.object({ kind: z.string().optional() }),
  execute: () => ({}),
};

export const billingOps: OpDefinition[] = [
  accountOp,
  checkoutCreateOp,
  portalCreateOp,
  subscriptionGetOp,
  entitledOp,
  usageRecordOp,
  billingEventTrigger,
];
