/**
 * @pattern-js/mod-billing — the contract surface.
 *
 * Driver mods (mod-billing-stripe, …) register a `BillingDriverSpec` here in
 * their `ready()`. Every call resolves the account by NAME at call time —
 * sourced secrets (vault/env), then the driver — so secret VALUES never sit
 * in workflow values or persisted config.
 *
 * `ingestEvent` is the webhook heart: verify+parse via the driver, CLAIM the
 * delivery (a docs row per provider event id with a processing state —
 * `processing` → `processed` | `failed` — so a redelivery of a finished event
 * is a duplicate, a redelivery of a FAILED one is a retry, and a concurrent
 * one is refused rather than acknowledged), update the user ↔ customer
 * mapping (serialized per customer, ordered by the provider's event time),
 * record one-time PURCHASES, project entitlement and grants into identity
 * ROLES — but only on actual transitions, because `setRoles` revokes sessions
 * and a renewal must never log anyone out — then emit the normalized
 * `billing.*` events any workflow can build on.
 */

import { resolveSourced, type OpContext } from "@pattern-js/core";
import { safeNextPath } from "./pages.js";
import { DEFAULT_ACCOUNT, type BillingConfigService } from "./config.js";
import { docsStore, identityLike, type DocsLike } from "./well-known.js";
import {
  BillingNoCustomerError,
  BillingNotConfiguredError,
  isEntitled,
  type BillingAccount,
  type BillingCustomer,
  type BillingDriverInfo,
  type BillingDriverSpec,
  type BillingEvent,
  type BillingPurchase,
  type DriverUsageEvent,
  type ProviderSubscription,
  type SubscriptionStatus,
} from "./types.js";

export const EVENTS_COLLECTION = "billing.events";
export const CUSTOMERS_COLLECTION = "billing.customers";
export const PURCHASES_COLLECTION = "billing.purchases";

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
  /**
   * Per-price grants: price key → identity role. A price bought OUTRIGHT
   * (a payment-mode checkout) grants its role for good; a price on an
   * entitled SUBSCRIPTION grants its role while the subscription is
   * entitled. Use the provider's lookup keys as price keys (`"pro"`,
   * `"lifetime"`) so this config never names a `price_…` id. Grants compose
   * with `entitlement` — both end in roles → scopes → `requireAuth`, so a
   * paid feature is the same gate whether it was subscribed to or bought.
   */
  grants?: Record<string, string>;
  /** Where checkout lands (appended to the public origin). */
  successPath?: string;
  cancelPath?: string;
  /**
   * Serve the packaged return pages at `successPath`/`cancelPath` (plus the
   * `statusPath` entitlement poller the success page uses). Default true —
   * set false to serve those paths yourself.
   */
  pages?: boolean;
  /** Where the success page polls the caller's entitlement. Default "/billing/status". */
  statusPath?: string;
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
  /**
   * Where the buyer should land AFTER the return page (relative-path guarded):
   * rides the success/cancel URLs as `?next=`, so the packaged pages forward
   * back to the gated page checkout was started from.
   */
  next?: string;
  /** Provider-side retry seal (the ops pin it to run+node). */
  idempotencyKey?: string;
}

export interface IngestResult {
  ok: true;
  /** The event type wasn't one the contract models — acknowledged, no-op. */
  ignored?: boolean;
  /** Same provider event id already PROCESSED — acknowledged, projection skipped. */
  duplicate?: boolean;
  /**
   * Another delivery of this event is being processed right now. The webhook
   * op answers non-2xx so the provider redelivers — acknowledging it would
   * lose the event if the in-flight attempt then fails.
   */
  inflight?: boolean;
  /** This delivery retried an event whose earlier attempt failed mid-projection. */
  reprocessed?: boolean;
  /** The event was older than the state already applied — recorded, not projected. */
  stale?: boolean;
  kind?: BillingEvent["kind"];
  /** The role projection actually changed the user's roles this delivery. */
  roleChanged?: boolean;
  /** A payment-mode checkout: the purchase recorded (and `purchase.completed` emitted). */
  purchase?: { priceKeys: string[]; quantity: number; amount?: number; currency?: string };
}

/** How long a `processing` claim stands before another delivery may take it over (the claimer died). */
const STALE_CLAIM_MS = 60_000;

type Claim = { state: "own"; key: string; attempts: number } | { state: "duplicate" } | { state: "inflight" };

export interface BillingService {
  /** Driver mods call this in their `ready()`; same-id re-registration replaces. */
  registerDriver(spec: BillingDriverSpec): void;
  drivers(): BillingDriverInfo[];
  driver(id: string): BillingDriverSpec | undefined;
  /** Create a hosted checkout session; redirect the browser to `url`. */
  checkout(input: CheckoutInput, ctx: OpContext): Promise<{ url: string; sessionId?: string }>;
  /** Create a customer-portal session for the user's provider customer. */
  portal(
    input: { account?: string; userId: string; origin?: string; idempotencyKey?: string },
    ctx: OpContext,
  ): Promise<{ url: string }>;
  /** Provider-fresh subscription state (falls back to the mapping). */
  subscription(
    input: { account?: string; userId: string },
    ctx: OpContext,
  ): Promise<{ status?: SubscriptionStatus; entitled: boolean; priceKeys: string[]; customerId?: string; purchased: string[] }>;
  /** The fast, offline entitlement check — reads the mapping, never the provider. */
  entitled(input: { userId: string }, ctx: OpContext): Promise<{ entitled: boolean; status?: SubscriptionStatus; purchased: string[] }>;
  /** Does the user own this price outright (a completed one-time purchase)? Mapping read, never the provider. */
  owns(input: { userId: string; priceKey: string }, ctx: OpContext): Promise<{ owns: boolean; purchased: string[] }>;
  /** Recorded one-time purchases, newest first (all, or one user's). */
  purchases(input: { userId?: string; limit?: number }, ctx: OpContext): Promise<BillingPurchase[]>;
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
  /** Per-customer projection locks: two deliveries for one customer never interleave their read-modify-write. */
  private readonly locks = new Map<string, Promise<unknown>>();

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
      throw new BillingNotConfiguredError(
        `no price to check out — set the "${account.name}" account's defaultPriceKey (admin → Administration → Billing) or pass \`priceKey\`.`,
      );
    }
    const origin = this.origin(ctx, input.origin);
    const mapping = input.userId ? await this.customerForUser(input.userId, ctx) : undefined;
    const mode = input.mode ?? "subscription";
    // `next` rides the return URLs so the packaged pages forward the buyer
    // back to the gated page checkout started from (relative-path guarded);
    // a one-time purchase also names its `item`, so the success page can wait
    // for OWNERSHIP of that price rather than a subscription entitlement.
    const q = new URLSearchParams();
    if (input.next) q.set("next", safeNextPath(input.next));
    if (mode === "payment") q.set("item", priceKey);
    const returnSuffix = q.size ? `?${q.toString()}` : "";
    return driver.createCheckout(
      {
        mode,
        priceKey,
        quantity: input.quantity ?? 1,
        successUrl: `${origin}${this.options.successPath ?? "/billing/success"}${returnSuffix}`,
        cancelUrl: `${origin}${this.options.cancelPath ?? "/billing/cancel"}${returnSuffix}`,
        userRef: input.userId,
        email: input.email,
        customerId: mapping?.customerId,
        idempotencyKey: input.idempotencyKey,
      },
      creds,
      account.options,
      ctx,
    );
  }

  async portal(
    input: { account?: string; userId: string; origin?: string; idempotencyKey?: string },
    ctx: OpContext,
  ): Promise<{ url: string }> {
    const { account, driver, creds } = await this.resolve(input.account, ctx);
    const mapping = await this.customerForUser(input.userId, ctx);
    if (!mapping?.customerId) {
      throw new BillingNoCustomerError(
        `nothing to manage yet — the portal drives an existing subscription; subscribe first.`,
      );
    }
    const origin = this.origin(ctx, input.origin);
    return driver.createPortal(
      {
        customerId: mapping.customerId,
        returnUrl: `${origin}${this.options.portalReturnPath ?? "/"}`,
        idempotencyKey: input.idempotencyKey,
      },
      creds,
      account.options,
      ctx,
    );
  }

  async subscription(
    input: { account?: string; userId: string },
    ctx: OpContext,
  ): Promise<{ status?: SubscriptionStatus; entitled: boolean; priceKeys: string[]; customerId?: string; purchased: string[] }> {
    const mapping = await this.customerForUser(input.userId, ctx);
    if (!mapping) return { entitled: false, priceKeys: [], purchased: [] };
    const purchased = mapping.purchased ?? [];
    if (mapping.subscriptionId) {
      try {
        const { account, driver, creds } = await this.resolve(input.account ?? mapping.account, ctx);
        const fresh: ProviderSubscription = await driver.getSubscription(mapping.subscriptionId, creds, account.options, ctx);
        return {
          status: fresh.status,
          entitled: isEntitled(fresh.status, this.grace()),
          priceKeys: fresh.priceKeys,
          customerId: fresh.customerId,
          purchased,
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
      purchased,
    };
  }

  async entitled(input: { userId: string }, ctx: OpContext): Promise<{ entitled: boolean; status?: SubscriptionStatus; purchased: string[] }> {
    const mapping = await this.customerForUser(input.userId, ctx);
    return { entitled: mapping?.entitled ?? false, status: mapping?.status, purchased: mapping?.purchased ?? [] };
  }

  async owns(input: { userId: string; priceKey: string }, ctx: OpContext): Promise<{ owns: boolean; purchased: string[] }> {
    const purchased = (await this.customerForUser(input.userId, ctx))?.purchased ?? [];
    return { owns: purchased.includes(input.priceKey), purchased };
  }

  async purchases(input: { userId?: string; limit?: number }, ctx: OpContext): Promise<BillingPurchase[]> {
    const store = docsStore(ctx);
    if (!store) return [];
    await this.ensureCollections(store);
    const rows = await store.docs.query({
      collection: PURCHASES_COLLECTION,
      ...(input.userId ? { where: { userId: input.userId } } : {}),
      orderBy: "at",
      orderDir: "desc",
      limit: input.limit ?? 200,
    });
    return rows.map((r) => r.data as unknown as BillingPurchase);
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

    // Claim the delivery. Providers redeliver on non-2xx and timeouts, so the
    // event id needs a durable state, not a mere "seen" mark: a row written
    // BEFORE the projection and never updated would turn a crash mid-projection
    // into a permanent duplicate — the customer never gets their role, and the
    // provider is told all is well.
    const store = docsStore(ctx);
    let claim: Claim | undefined;
    if (store) {
      await this.ensureCollections(store);
      claim = await this.claimDelivery(store, account, evt);
      if (claim.state === "duplicate") return { ok: true, duplicate: true, kind: evt.kind };
      if (claim.state === "inflight") return { ok: true, inflight: true, kind: evt.kind };
    }
    const rowBase = { provider: account.provider, account: account.name, eventId: evt.eventId, kind: evt.kind, eventAt: evt.at };

    let projection: Projection;
    try {
      // Serialized per customer: two deliveries for one customer (a renewal
      // and a cancellation, say) read-modify-write the same mapping row.
      projection = await this.withCustomerLock(this.customerKey(evt, account), () => this.project(evt, account, ctx));
    } catch (err) {
      // Leave a retryable record and fail the delivery: the provider's
      // redelivery (or a manual resend) reprocesses it.
      if (store && claim?.state === "own") {
        await store.docs.put(EVENTS_COLLECTION, claim.key, {
          ...rowBase,
          status: "failed",
          attempts: claim.attempts,
          at: Date.now(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    }
    if (store && claim?.state === "own") {
      await store.docs.put(EVENTS_COLLECTION, claim.key, { ...rowBase, status: "processed", attempts: claim.attempts, at: Date.now() });
    }

    ctx.services.events.emit(`billing.${evt.kind}`, {
      account: account.name,
      provider: account.provider,
      event: evt,
      ...projection,
    });
    // A one-time purchase is its own headline: "on purchase → provision" is
    // a `billing.event` trigger on `purchase.completed`, not a filter over
    // checkout.completed's mode.
    if (evt.kind === "checkout.completed" && projection.purchase) {
      const purchase: BillingEvent = {
        kind: "purchase.completed",
        eventId: evt.eventId,
        at: evt.at,
        customerId: evt.customerId,
        userRef: evt.userRef,
        email: evt.email,
        priceKeys: projection.purchase.priceKeys,
        quantity: projection.purchase.quantity,
        amount: projection.purchase.amount,
        currency: projection.purchase.currency,
        sessionId: evt.sessionId,
        paymentIntentId: evt.paymentIntentId,
      };
      ctx.services.events.emit("billing.purchase.completed", { account: account.name, provider: account.provider, event: purchase, roleChanged: projection.roleChanged });
    }
    return {
      ok: true,
      kind: evt.kind,
      ...(claim?.state === "own" && claim.attempts > 1 ? { reprocessed: true } : {}),
      ...projection,
    };
  }

  /**
   * The delivery state machine, one docs row per provider event id:
   *   (none)      → create `processing` (version 1 = ours; anything else lost a race → inflight)
   *   processed   → duplicate (acknowledge, never re-project)
   *   processing  → inflight while fresh; a STALE claim (its process died) is taken over
   *   failed      → taken over (the retry the provider's redelivery exists for)
   * Take-overs CAS on the row version so two takers can't both win. Rows
   * written before states existed carry no status and count as processed —
   * the pre-0.5.0 semantics they were written under.
   */
  private async claimDelivery(store: DocsLike, account: BillingAccount, evt: BillingEvent): Promise<Claim> {
    const key = `${account.provider}:${evt.eventId}`;
    const base = { provider: account.provider, account: account.name, eventId: evt.eventId, kind: evt.kind, eventAt: evt.at };
    const now = Date.now();
    const existing = await store.docs.get(EVENTS_COLLECTION, key);
    if (!existing) {
      const row = await store.docs.put(EVENTS_COLLECTION, key, { ...base, status: "processing", attempts: 1, at: now });
      return row && row.version === 1 ? { state: "own", key, attempts: 1 } : { state: "inflight" };
    }
    const d = existing.data as { status?: string; attempts?: number; at?: number };
    const status = d.status ?? "processed";
    if (status === "processed") return { state: "duplicate" };
    if (status === "processing" && now - (d.at ?? 0) < STALE_CLAIM_MS) return { state: "inflight" };
    const attempts = (d.attempts ?? 1) + 1;
    const row = await store.docs.put(EVENTS_COLLECTION, key, { ...base, status: "processing", attempts, at: now }, existing.version);
    return row ? { state: "own", key, attempts } : { state: "inflight" };
  }

  private customerKey(evt: BillingEvent, account: BillingAccount): string | undefined {
    const customerId = "customerId" in evt ? evt.customerId : undefined;
    return customerId ? `${account.provider}:${customerId}` : undefined;
  }

  /** Run `fn` after every earlier holder of `key` has finished (in-process; the deployment model is one host). */
  private async withCustomerLock<T>(key: string | undefined, fn: () => Promise<T>): Promise<T> {
    if (!key) return fn();
    const prev = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const mine = prev.then(() => gate);
    this.locks.set(key, mine);
    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === mine) this.locks.delete(key);
    }
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
      throw new BillingNotConfiguredError(`no account "${accountName}" is configured — add it in admin → Administration → Billing.`);
    }
    const driver = this.registry.get(account.provider);
    if (!driver) {
      throw new BillingNotConfiguredError(
        `account "${account.name}" uses provider "${account.provider}" but no such driver is registered — ` +
          `install its mod (e.g. @pattern-js/mod-billing-${account.provider}) and list it in pattern.config.json.`,
      );
    }
    for (const field of driver.secrets.filter((s) => s.required !== false)) {
      if (!account.secrets[field.field]) {
        throw new BillingNotConfiguredError(
          `account "${account.name}" is missing the "${field.field}" secret its ${driver.label} driver requires (admin → Administration → Billing).`,
        );
      }
    }
    const creds: Record<string, string> = {};
    for (const [field, ref] of Object.entries(account.secrets)) {
      try {
        creds[field] = await resolveSourced(ctx, ref, "mod-billing");
      } catch (err) {
        // An unset env var / missing vault secret is SETUP, not failure.
        throw new BillingNotConfiguredError(
          `account "${account.name}"'s "${field}" secret can't resolve — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { account, driver, creds };
  }

  private async ensureCollections(store: DocsLike): Promise<void> {
    if (this.ensured) return;
    this.ensured = true;
    await store.docs.ensureCollection({ name: EVENTS_COLLECTION, indexes: ["provider", "kind", "status"] });
    await store.docs.ensureCollection({ name: CUSTOMERS_COLLECTION, indexes: ["userId", "customerId", "provider"] });
    // `at` is indexed: the admin lists purchases newest-first by purchase time.
    await store.docs.ensureCollection({ name: PURCHASES_COLLECTION, indexes: ["userId", "customerId", "provider", "at"] });
  }

  /**
   * Fold one event into the customer mapping, then project entitlement into
   * the identity role. Events can arrive out of order (subscription.updated
   * may beat checkout.completed), so every mapping write MERGES and every
   * write re-projects. State-bearing events (subscription.*) additionally
   * carry the provider's event time: one older than the watermark already
   * applied is recorded but NOT projected — a delayed "active" delivered after
   * a "deleted" would otherwise hand a canceled customer their access back.
   */
  private async project(evt: BillingEvent, account: BillingAccount, ctx: OpContext): Promise<Projection> {
    const store = docsStore(ctx);
    const customerId = "customerId" in evt ? evt.customerId : undefined;
    if (!store || !customerId) {
      if (store && evt.kind === "checkout.completed" && evt.mode === "payment") {
        console.warn(
          `[pattern/mod-billing] payment-mode checkout ${evt.sessionId ?? evt.eventId} arrived without a customer id — the purchase can't be recorded against a user. The driver must create a customer for one-time checkouts.`,
        );
      }
      return {};
    }

    const id = `${account.provider}:${customerId}`;
    const existing = (await store.docs.get(CUSTOMERS_COLLECTION, id))?.data as unknown as BillingCustomer | undefined;
    const stateBearing = evt.kind === "subscription.updated" || evt.kind === "subscription.deleted";
    if (stateBearing && evt.at !== undefined && existing?.lastEventAt !== undefined && evt.at < existing.lastEventAt) {
      return { stale: true };
    }
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
      lastEventAt: stateBearing ? (evt.at ?? existing?.lastEventAt) : existing?.lastEventAt,
      ...(existing?.purchased ? { purchased: existing.purchased } : {}),
    };
    let purchase: Projection["purchase"];

    switch (evt.kind) {
      case "checkout.completed":
        next.userId = evt.userRef ?? next.userId;
        next.email = evt.email ?? next.email;
        next.subscriptionId = evt.subscriptionId ?? next.subscriptionId;
        if (evt.mode === "payment") {
          // A one-time purchase: record it (keyed by the session, so a
          // redelivered event can't double-record) and mark the prices OWNED.
          const priceKeys = evt.priceKeys ?? [];
          const quantity = evt.quantity ?? 1;
          const row: BillingPurchase = {
            userId: next.userId,
            customerId,
            provider: account.provider,
            account: account.name,
            priceKeys,
            quantity,
            amount: evt.amount,
            currency: evt.currency,
            sessionId: evt.sessionId,
            paymentIntentId: evt.paymentIntentId,
            eventId: evt.eventId,
            at: evt.at ?? Date.now(),
          };
          await store.docs.put(PURCHASES_COLLECTION, `${account.provider}:${evt.sessionId ?? evt.eventId}`, row as unknown as Record<string, unknown>);
          next.purchased = [...new Set([...(next.purchased ?? []), ...priceKeys])];
          purchase = { priceKeys, quantity, amount: evt.amount, currency: evt.currency };
        }
        break;
      case "purchase.completed":
        // Derived by this service, never ingested — nothing to fold.
        return {};
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
    return { ...(await this.projectRoles(next, ctx)), ...(purchase ? { purchase } : {}) };
  }

  /**
   * The entitlement bridge: the roles billing MANAGES (the entitlement role +
   * every role a grant names) are recomputed from the mapping — the
   * entitlement role and the grants of subscribed prices while entitled, the
   * grants of purchased prices for good — and written ONLY on an actual
   * transition, leaving every other role alone. `setRoles` revokes the user's
   * sessions (privilege change), so a no-op write would log people out on
   * every renewal webhook.
   */
  private async projectRoles(mapping: BillingCustomer, ctx: OpContext): Promise<{ roleChanged?: boolean }> {
    const rule = this.options.entitlement === false ? undefined : (this.options.entitlement ?? { role: "member" });
    const grants = this.options.grants ?? {};
    const managed = new Set<string>([...(rule?.role ? [rule.role] : []), ...Object.values(grants)]);
    if (managed.size === 0 || !mapping.userId) return {};
    const identity = identityLike(ctx);
    if (!identity) return {};
    const user = await identity.getUser(mapping.userId);
    if (!user) return {};

    const desired = new Set<string>();
    if (mapping.entitled) {
      if (rule?.role) desired.add(rule.role);
      for (const p of mapping.priceKeys ?? []) if (grants[p]) desired.add(grants[p]!);
    }
    for (const p of mapping.purchased ?? []) if (grants[p]) desired.add(grants[p]!);

    const current = user.roles;
    const next = [...current.filter((r) => !managed.has(r) || desired.has(r)), ...[...desired].filter((r) => !current.includes(r))];
    const same = next.length === current.length && next.every((r) => current.includes(r));
    if (same) return { roleChanged: false };
    await identity.setRoles(user.id, next);
    return { roleChanged: true };
  }
}

/** What folding one event changed: roles, the ordering verdict, a recorded purchase. */
interface Projection {
  roleChanged?: boolean;
  stale?: boolean;
  purchase?: { priceKeys: string[]; quantity: number; amount?: number; currency?: string };
}
