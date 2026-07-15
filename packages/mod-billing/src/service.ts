/**
 * @pattern-js/mod-billing — the contract surface.
 *
 * Driver mods (mod-billing-stripe, …) register a `BillingDriverSpec` here in
 * their `ready()`. Every call resolves the account by NAME at call time —
 * sourced secrets (vault/env), then the driver — so secret VALUES never sit
 * in workflow values or persisted config.
 *
 * `ingestEvent` is the webhook heart: verify+parse via the driver, dedup on
 * the provider's stable event id (a CAS'd docs row — the row's version says
 * whether we created it), update the user ↔ customer mapping, project the
 * entitlement into an identity ROLE — but only on actual transitions, because
 * `setRoles` revokes sessions and a renewal must never log anyone out — then
 * emit the normalized `billing.*` events any workflow can build on.
 */

import { resolveSourced, type OpContext } from "@pattern-js/core";
import { DEFAULT_ACCOUNT, type BillingConfigService } from "./config.js";
import { docsStore, identityLike, type DocsLike } from "./well-known.js";
import {
  isEntitled,
  type BillingAccount,
  type BillingCustomer,
  type BillingDriverInfo,
  type BillingDriverSpec,
  type BillingEvent,
  type DriverUsageEvent,
  type ProviderSubscription,
  type SubscriptionStatus,
} from "./types.js";

export const EVENTS_COLLECTION = "billing.events";
export const CUSTOMERS_COLLECTION = "billing.customers";

export interface BillingModOptions {
  /** Where accounts persist. Default ".pattern-data/billing-config.json". */
  configPath?: string;
  /**
   * The subscription → identity-role bridge: an entitled subscription grants
   * `role`; losing it removes the role. Roles → scopes is identity's map, so
   * "paid feature" becomes an ordinary `requireAuth` scope. `false` disables
   * projection. `gracePastDue` keeps access while the provider retries a
   * failing renewal.
   */
  entitlement?: { role: string; gracePastDue?: boolean } | false;
  /** Where checkout lands (appended to the public origin). */
  successPath?: string;
  cancelPath?: string;
  /** Where the customer portal returns to. */
  portalReturnPath?: string;
  /**
   * Meter AI usage: when true (and the metering workflow is seeded), `ai.usage`
   * events record to the provider meter named here. Consumed by the packaged
   * metering workflow — carried on options so one flag turns the loop on.
   */
  meterAiUsage?: boolean;
  /** The provider meter event name for AI usage. Default "ai_tokens". */
  aiMeter?: string;
}

export interface CheckoutInput {
  account?: string;
  userId?: string;
  email?: string;
  /** Overrides the account's defaultPriceKey option. */
  priceKey?: string;
  mode?: "subscription" | "payment";
  quantity?: number;
  /** Request-derived origin; PATTERN_PUBLIC_URL beats it (proxies lie). */
  origin?: string;
}

export interface IngestResult {
  ok: true;
  /** The event type wasn't one the contract models — acknowledged, no-op. */
  ignored?: boolean;
  /** Same provider event id seen before — acknowledged, projection skipped. */
  duplicate?: boolean;
  kind?: BillingEvent["kind"];
  /** The role projection actually changed the user's roles this delivery. */
  roleChanged?: boolean;
}

export interface BillingService {
  /** Driver mods call this in their `ready()`; same-id re-registration replaces. */
  registerDriver(spec: BillingDriverSpec): void;
  drivers(): BillingDriverInfo[];
  driver(id: string): BillingDriverSpec | undefined;
  /** Create a hosted checkout session; redirect the browser to `url`. */
  checkout(input: CheckoutInput, ctx: OpContext): Promise<{ url: string; sessionId?: string }>;
  /** Create a customer-portal session for the user's provider customer. */
  portal(input: { account?: string; userId: string; origin?: string }, ctx: OpContext): Promise<{ url: string }>;
  /** Provider-fresh subscription state (falls back to the mapping). */
  subscription(
    input: { account?: string; userId: string },
    ctx: OpContext,
  ): Promise<{ status?: SubscriptionStatus; entitled: boolean; priceKeys: string[]; customerId?: string }>;
  /** The fast, offline entitlement check — reads the mapping, never the provider. */
  entitled(input: { userId: string }, ctx: OpContext): Promise<{ entitled: boolean; status?: SubscriptionStatus }>;
  /** Record a metered-usage event against the user's (or an explicit) customer. */
  recordUsage(
    input: { account?: string; userId?: string; customerId?: string; meter: string; value: number; identifier?: string },
    ctx: OpContext,
  ): Promise<{ ok: true }>;
  /** Webhook heart: verify → dedup → map → project roles → emit. */
  ingestEvent(raw: Uint8Array, headers: Record<string, string>, accountName: string, ctx: OpContext): Promise<IngestResult>;
  /** Resolve ONE of an account's sourced secrets (webhook ops pre-check with this). */
  accountSecret(accountName: string, field: string, ctx: OpContext): Promise<string | undefined>;
  /** The mapping row for a user, when the store is present. */
  customerForUser(userId: string, ctx: OpContext): Promise<BillingCustomer | undefined>;
}

export class DefaultBillingService implements BillingService {
  private readonly registry = new Map<string, BillingDriverSpec>();
  private ensured = false;

  constructor(
    private readonly config: BillingConfigService,
    private readonly options: BillingModOptions = {},
  ) {}

  registerDriver(spec: BillingDriverSpec): void {
    this.registry.set(spec.id, spec);
  }

  drivers(): BillingDriverInfo[] {
    return [...this.registry.values()].map(
      ({ createCheckout: _c, createPortal: _p, getSubscription: _g, recordUsage: _u, verifyAndParse: _v, ...info }) => info,
    );
  }

  driver(id: string): BillingDriverSpec | undefined {
    return this.registry.get(id);
  }

  /* ── checkout / portal / subscription / usage ─────────────────────── */

  async checkout(input: CheckoutInput, ctx: OpContext): Promise<{ url: string; sessionId?: string }> {
    const { account, driver, creds } = await this.resolve(input.account, ctx);
    const priceKey = input.priceKey?.trim() || account.options.defaultPriceKey;
    if (!priceKey) {
      throw new Error(
        `mod-billing: no price to check out — pass \`priceKey\` or set the "${account.name}" account's defaultPriceKey option.`,
      );
    }
    const origin = this.origin(ctx, input.origin);
    const mapping = input.userId ? await this.customerForUser(input.userId, ctx) : undefined;
    return driver.createCheckout(
      {
        mode: input.mode ?? "subscription",
        priceKey,
        quantity: input.quantity ?? 1,
        successUrl: `${origin}${this.options.successPath ?? "/billing/success"}`,
        cancelUrl: `${origin}${this.options.cancelPath ?? "/billing/cancel"}`,
        userRef: input.userId,
        email: input.email,
        customerId: mapping?.customerId,
      },
      creds,
      account.options,
      ctx,
    );
  }

  async portal(input: { account?: string; userId: string; origin?: string }, ctx: OpContext): Promise<{ url: string }> {
    const { account, driver, creds } = await this.resolve(input.account, ctx);
    const mapping = await this.customerForUser(input.userId, ctx);
    if (!mapping?.customerId) {
      throw new Error(
        `mod-billing: user "${input.userId}" has no billing customer yet — the portal manages an existing subscription; start with a checkout.`,
      );
    }
    const origin = this.origin(ctx, input.origin);
    return driver.createPortal(
      { customerId: mapping.customerId, returnUrl: `${origin}${this.options.portalReturnPath ?? "/"}` },
      creds,
      account.options,
      ctx,
    );
  }

  async subscription(
    input: { account?: string; userId: string },
    ctx: OpContext,
  ): Promise<{ status?: SubscriptionStatus; entitled: boolean; priceKeys: string[]; customerId?: string }> {
    const mapping = await this.customerForUser(input.userId, ctx);
    if (!mapping) return { entitled: false, priceKeys: [] };
    if (mapping.subscriptionId) {
      try {
        const { account, driver, creds } = await this.resolve(input.account ?? mapping.account, ctx);
        const fresh: ProviderSubscription = await driver.getSubscription(mapping.subscriptionId, creds, account.options, ctx);
        return {
          status: fresh.status,
          entitled: isEntitled(fresh.status, this.grace()),
          priceKeys: fresh.priceKeys,
          customerId: fresh.customerId,
        };
      } catch {
        /* provider unreachable — the mapping is the best truth we have */
      }
    }
    return {
      status: mapping.status,
      entitled: mapping.entitled,
      priceKeys: mapping.priceKeys ?? [],
      customerId: mapping.customerId,
    };
  }

  async entitled(input: { userId: string }, ctx: OpContext): Promise<{ entitled: boolean; status?: SubscriptionStatus }> {
    const mapping = await this.customerForUser(input.userId, ctx);
    return { entitled: mapping?.entitled ?? false, status: mapping?.status };
  }

  async recordUsage(
    input: { account?: string; userId?: string; customerId?: string; meter: string; value: number; identifier?: string },
    ctx: OpContext,
  ): Promise<{ ok: true }> {
    const { account, driver, creds } = await this.resolve(input.account, ctx);
    let customerId = input.customerId;
    if (!customerId && input.userId) customerId = (await this.customerForUser(input.userId, ctx))?.customerId;
    if (!customerId) {
      throw new Error(
        `mod-billing: nothing to bill — pass \`customerId\`, or a \`userId\` with an existing billing customer.`,
      );
    }
    const evt: DriverUsageEvent = {
      customerId,
      meter: input.meter,
      value: input.value,
      identifier: input.identifier,
    };
    await driver.recordUsage(evt, creds, account.options, ctx);
    return { ok: true };
  }

  /* ── the webhook heart ─────────────────────────────────────────────── */

  async ingestEvent(
    raw: Uint8Array,
    headers: Record<string, string>,
    accountName: string,
    ctx: OpContext,
  ): Promise<IngestResult> {
    const { account, driver, creds } = await this.resolve(accountName, ctx);
    const evt = await driver.verifyAndParse(raw, headers, creds, account.options, ctx);
    if (!evt) return { ok: true, ignored: true };

    // Dedup on the provider's stable event id: providers redeliver on non-2xx
    // and timeouts. The upsert's returned version says who created the row —
    // version 1 means this delivery owns the projection.
    const store = docsStore(ctx);
    if (store) {
      await this.ensureCollections(store);
      const row = await store.docs.put(EVENTS_COLLECTION, `${account.provider}:${evt.eventId}`, {
        provider: account.provider,
        account: account.name,
        eventId: evt.eventId,
        kind: evt.kind,
        at: Date.now(),
      });
      if (row && row.version > 1) return { ok: true, duplicate: true, kind: evt.kind };
    }

    const projection = await this.project(evt, account, ctx);
    ctx.services.events.emit(`billing.${evt.kind}`, {
      account: account.name,
      provider: account.provider,
      event: evt,
      ...projection,
    });
    return { ok: true, kind: evt.kind, ...projection };
  }

  async accountSecret(accountName: string, field: string, ctx: OpContext): Promise<string | undefined> {
    const account = this.config.account(accountName);
    const ref = account?.secrets[field];
    if (!ref?.key) return undefined;
    return resolveSourced(ctx, ref, "mod-billing");
  }

  async customerForUser(userId: string, ctx: OpContext): Promise<BillingCustomer | undefined> {
    const store = docsStore(ctx);
    if (!store) return undefined;
    await this.ensureCollections(store);
    const rows = await store.docs.query({
      collection: CUSTOMERS_COLLECTION,
      where: { userId },
      orderBy: "updatedAt",
      orderDir: "desc",
      limit: 1,
    });
    return rows[0] ? (rows[0].data as unknown as BillingCustomer) : undefined;
  }

  /* ── internals ─────────────────────────────────────────────────────── */

  private grace(): boolean {
    const rule = this.options.entitlement;
    return rule !== false && Boolean(rule?.gracePastDue);
  }

  /** PATTERN_PUBLIC_URL beats the request-derived origin (proxies lie). */
  private origin(ctx: OpContext, requestOrigin?: string): string {
    const configured = ctx.env.PATTERN_PUBLIC_URL?.trim();
    const origin = (configured || requestOrigin || "http://localhost:3000").replace(/\/$/, "");
    if (!configured && !requestOrigin) {
      console.warn("[pattern/mod-billing] no PATTERN_PUBLIC_URL set — checkout redirect URLs assume http://localhost:3000");
    }
    return origin;
  }

  private async resolve(
    name: string | undefined,
    ctx: OpContext,
  ): Promise<{ account: BillingAccount; driver: BillingDriverSpec; creds: Record<string, string> }> {
    const accountName = name?.trim() || DEFAULT_ACCOUNT;
    const account = this.config.account(accountName);
    if (!account) {
      throw new Error(`mod-billing: no account "${accountName}" is configured — add it in admin → System → Billing.`);
    }
    const driver = this.registry.get(account.provider);
    if (!driver) {
      throw new Error(
        `mod-billing: account "${account.name}" uses provider "${account.provider}" but no such driver is registered — ` +
          `install its mod (e.g. @pattern-js/mod-billing-${account.provider}) and list it in pattern.config.json.`,
      );
    }
    for (const field of driver.secrets.filter((s) => s.required !== false)) {
      if (!account.secrets[field.field]) {
        throw new Error(
          `mod-billing: account "${account.name}" is missing the "${field.field}" secret its ${driver.label} driver requires.`,
        );
      }
    }
    const creds: Record<string, string> = {};
    for (const [field, ref] of Object.entries(account.secrets)) {
      creds[field] = await resolveSourced(ctx, ref, "mod-billing");
    }
    return { account, driver, creds };
  }

  private async ensureCollections(store: DocsLike): Promise<void> {
    if (this.ensured) return;
    this.ensured = true;
    await store.docs.ensureCollection({ name: EVENTS_COLLECTION, indexes: ["provider", "kind"] });
    await store.docs.ensureCollection({ name: CUSTOMERS_COLLECTION, indexes: ["userId", "customerId", "provider"] });
  }

  /**
   * Fold one event into the customer mapping, then project entitlement into
   * the identity role. Events can arrive out of order (subscription.updated
   * may beat checkout.completed), so every mapping write MERGES and every
   * write re-projects — whichever event lands last still converges.
   */
  private async project(evt: BillingEvent, account: BillingAccount, ctx: OpContext): Promise<{ roleChanged?: boolean }> {
    const store = docsStore(ctx);
    const customerId = "customerId" in evt ? evt.customerId : undefined;
    if (!store || !customerId) return {};

    const id = `${account.provider}:${customerId}`;
    const existing = (await store.docs.get(CUSTOMERS_COLLECTION, id))?.data as unknown as BillingCustomer | undefined;
    const next: BillingCustomer = {
      userId: existing?.userId,
      customerId,
      provider: account.provider,
      account: account.name,
      email: existing?.email,
      subscriptionId: existing?.subscriptionId,
      status: existing?.status,
      priceKeys: existing?.priceKeys,
      entitled: existing?.entitled ?? false,
      updatedAt: Date.now(),
    };

    switch (evt.kind) {
      case "checkout.completed":
        next.userId = evt.userRef ?? next.userId;
        next.email = evt.email ?? next.email;
        next.subscriptionId = evt.subscriptionId ?? next.subscriptionId;
        break;
      case "subscription.updated":
        next.subscriptionId = evt.subscriptionId;
        next.status = evt.status;
        next.priceKeys = evt.priceKeys;
        next.entitled = isEntitled(evt.status, this.grace());
        break;
      case "subscription.deleted":
        next.subscriptionId = evt.subscriptionId;
        next.status = "canceled";
        next.priceKeys = [];
        next.entitled = false;
        break;
      case "invoice.paid":
      case "invoice.payment_failed":
        // State lives on the subscription events; invoices just emit.
        return {};
    }

    await store.docs.put(CUSTOMERS_COLLECTION, id, next as unknown as Record<string, unknown>);
    return this.projectRole(next, ctx);
  }

  /**
   * The entitlement bridge: grant/remove the configured role — ONLY on an
   * actual transition. `setRoles` revokes the user's sessions (privilege
   * change), so a no-op write would log people out on every renewal webhook.
   */
  private async projectRole(mapping: BillingCustomer, ctx: OpContext): Promise<{ roleChanged?: boolean }> {
    const rule = this.options.entitlement === false ? undefined : (this.options.entitlement ?? { role: "member" });
    if (!rule?.role || !mapping.userId) return {};
    const identity = identityLike(ctx);
    if (!identity) return {};
    const user = await identity.getUser(mapping.userId);
    if (!user) return {};
    const has = user.roles.includes(rule.role);
    if (mapping.entitled && !has) {
      await identity.setRoles(user.id, [...user.roles, rule.role]);
      return { roleChanged: true };
    }
    if (!mapping.entitled && has) {
      await identity.setRoles(user.id, user.roles.filter((r) => r !== rule.role));
      return { roleChanged: true };
    }
    return { roleChanged: false };
  }
}
