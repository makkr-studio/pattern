/**
 * The billing contract, end to end against a scripted driver: accounts hold
 * secret REFS, ingestEvent dedups on the provider's stable event id, the
 * customer mapping folds out-of-order events, role projection fires ONLY on
 * entitlement transitions (setRoles revokes sessions — a renewal must never
 * log anyone out), and the billing.event trigger runs workflows off the bus.
 * No HTTP, no ports — the engine's own wiring carries all of it.
 */
import { describe, it, expect } from "vitest";
import { Engine, type OpContext, type Workflow } from "@pattern-js/core";
import {
  BILLING_SERVICE,
  BillingConfigService,
  billingMod,
  type BillingDriverSpec,
  type BillingEvent,
  type BillingService,
} from "@pattern-js/mod-billing";

/* ── fakes ────────────────────────────────────────────────────────────── */

function fakeStore() {
  const collections = new Map<string, Map<string, { id: string; data: Record<string, unknown>; version: number; createdAt: number; updatedAt: number }>>();
  const coll = (name: string) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name)!;
  };
  return {
    docs: {
      async ensureCollection() {},
      async get(collection: string, id: string) {
        const row = coll(collection).get(id);
        return row ? { ...row, data: { ...row.data } } : null;
      },
      async put(collection: string, id: string, data: Record<string, unknown>) {
        const existing = coll(collection).get(id);
        const row = {
          id,
          data,
          version: (existing?.version ?? 0) + 1,
          createdAt: existing?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
        };
        coll(collection).set(id, row);
        return { ...row };
      },
      async query(opts: { collection: string; where?: Record<string, unknown>; limit?: number }) {
        let rows = [...coll(opts.collection).values()];
        for (const [k, v] of Object.entries(opts.where ?? {})) rows = rows.filter((r) => r.data[k] === v);
        return rows.slice(0, opts.limit ?? rows.length).map((r) => ({ ...r, data: { ...r.data } }));
      },
    },
  };
}

function fakeIdentity(seed: Record<string, string[]> = {}) {
  const users = new Map(Object.entries(seed).map(([id, roles]) => [id, { id, roles: [...roles] }]));
  const setRolesCalls: Array<{ userId: string; roles: string[] }> = [];
  return {
    users,
    setRolesCalls,
    async getUser(id: string) {
      return users.get(id) ?? null;
    },
    async findUserByEmail() {
      return null;
    },
    async setRoles(userId: string, roles: string[]) {
      setRolesCalls.push({ userId, roles: [...roles] });
      const u = users.get(userId);
      if (u) u.roles = [...roles];
      return u;
    },
  };
}

/** A scripted driver: verifyAndParse pops the events queue; calls recorded. */
function fakeDriver() {
  const parsed: Array<BillingEvent | null> = [];
  const checkouts: Array<Record<string, unknown>> = [];
  const usage: Array<Record<string, unknown>> = [];
  const spec: BillingDriverSpec = {
    id: "fake",
    label: "Fake Pay",
    secrets: [{ field: "apiKey", label: "API key", required: true }],
    options: [{ field: "defaultPriceKey", label: "Default price", required: false }],
    async createCheckout(req) {
      checkouts.push({ ...req });
      return { url: "https://pay.example/session_1", sessionId: "cs_1" };
    },
    async createPortal(req) {
      return { url: `https://pay.example/portal/${req.customerId}` };
    },
    async getSubscription(subscriptionId) {
      return { subscriptionId, customerId: "cus_1", status: "active", priceKeys: ["price_pro"] };
    },
    async recordUsage(evt) {
      usage.push({ ...evt });
    },
    async verifyAndParse() {
      if (!parsed.length) throw new Error("fakeDriver: no scripted event");
      return parsed.shift()!;
    },
  };
  return { spec, parsed, checkouts, usage };
}

/* ── harness ──────────────────────────────────────────────────────────── */

async function boot(opts: { entitlement?: { role: string; gracePastDue?: boolean } | false; identity?: ReturnType<typeof fakeIdentity> } = {}) {
  const engine = new Engine({ env: { PATTERN_PUBLIC_URL: "https://app.example" } });
  const configPath = `/tmp/pattern-billing-test-${Math.random().toString(36).slice(2)}.json`;
  const mod = billingMod({ configPath, entitlement: opts.entitlement ?? { role: "member" } });
  await engine.useAsync(mod, { deferReady: true });
  await mod.ready?.(engine);
  const store = fakeStore();
  const identity = opts.identity ?? fakeIdentity({ ada: ["admin"] });
  engine.provideService("storeService", store);
  engine.provideService("identityService", identity);
  const svc = engine.service<BillingService>(BILLING_SERVICE)!;
  const driver = fakeDriver();
  svc.registerDriver(driver.spec);
  const config = engine.service<BillingConfigService>("billingConfig")!;
  await config.upsertAccount({
    name: "default",
    provider: "fake",
    secrets: { apiKey: { source: "env", key: "FAKE_KEY" } },
    options: { defaultPriceKey: "price_pro" },
  });
  const ctx = {
    services: new Proxy({}, { get: (_t, p: string) => engine.service(p) ?? (p === "events" ? engine.events : undefined) }),
    env: { PATTERN_PUBLIC_URL: "https://app.example", FAKE_KEY: "sk_fake" },
    principal: { kind: "anonymous" },
  } as unknown as OpContext;
  return { engine, svc, config, driver, store, identity, ctx };
}

const subUpdated = (eventId: string, status = "active"): BillingEvent => ({
  kind: "subscription.updated",
  eventId,
  customerId: "cus_1",
  subscriptionId: "sub_1",
  status: status as "active",
  priceKeys: ["price_pro"],
});

/* ── tests ────────────────────────────────────────────────────────────── */

describe("billing accounts", () => {
  it("persists accounts with secret REFS only and resolves edge-safe refs", async () => {
    const { config } = await boot();
    const account = config.account("default")!;
    expect(account.secrets.apiKey).toEqual({ source: "env", key: "FAKE_KEY" });
    expect(JSON.stringify(account)).not.toContain("sk_fake");
    expect(config.resolveAccount("default")).toEqual({ kind: "billingAccount", account: "default", provider: "fake" });
    await config.deleteAccount("default");
    expect(config.account("default")).toBeUndefined();
  });
});

describe("ingestEvent", () => {
  it("dedups on the provider's stable event id — one projection per event", async () => {
    const { svc, driver, identity, ctx } = await boot();
    driver.parsed.push({ kind: "checkout.completed", eventId: "evt_0", customerId: "cus_1", subscriptionId: "sub_1", userRef: "ada" });
    await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    driver.parsed.push(subUpdated("evt_1"), subUpdated("evt_1"));
    const first = await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    const second = await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    expect(first).toMatchObject({ ok: true, kind: "subscription.updated", roleChanged: true });
    expect(second).toMatchObject({ ok: true, duplicate: true });
    // The redelivery never re-projected.
    expect(identity.setRolesCalls).toHaveLength(1);
    expect(identity.setRolesCalls[0]).toEqual({ userId: "ada", roles: ["admin", "member"] });
  });

  it("projects the role ONLY on transitions — renewals never touch setRoles", async () => {
    const { svc, driver, identity, ctx } = await boot();
    driver.parsed.push({ kind: "checkout.completed", eventId: "evt_0", customerId: "cus_1", userRef: "ada" });
    await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    driver.parsed.push(subUpdated("evt_1"));
    await svc.ingestEvent(new Uint8Array(), {}, "default", ctx); // grants
    driver.parsed.push(subUpdated("evt_2")); // a renewal: still active
    const renewal = await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    expect(renewal.roleChanged).toBe(false);
    expect(identity.setRolesCalls).toHaveLength(1);
    driver.parsed.push({ kind: "subscription.deleted", eventId: "evt_3", customerId: "cus_1", subscriptionId: "sub_1" });
    const deleted = await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    expect(deleted.roleChanged).toBe(true);
    expect(identity.setRolesCalls).toHaveLength(2);
    expect(identity.setRolesCalls[1]).toEqual({ userId: "ada", roles: ["admin"] });
  });

  it("past_due entitles only under gracePastDue", async () => {
    const strict = await boot();
    strict.driver.parsed.push({ kind: "checkout.completed", eventId: "e0", customerId: "cus_1", userRef: "ada" });
    await strict.svc.ingestEvent(new Uint8Array(), {}, "default", strict.ctx);
    strict.driver.parsed.push(subUpdated("e1", "past_due"));
    await strict.svc.ingestEvent(new Uint8Array(), {}, "default", strict.ctx);
    expect((await strict.svc.entitled({ userId: "ada" }, strict.ctx)).entitled).toBe(false);

    const graceful = await boot({ entitlement: { role: "member", gracePastDue: true } });
    graceful.driver.parsed.push({ kind: "checkout.completed", eventId: "e0", customerId: "cus_1", userRef: "ada" });
    await graceful.svc.ingestEvent(new Uint8Array(), {}, "default", graceful.ctx);
    graceful.driver.parsed.push(subUpdated("e1", "past_due"));
    await graceful.svc.ingestEvent(new Uint8Array(), {}, "default", graceful.ctx);
    expect((await graceful.svc.entitled({ userId: "ada" }, graceful.ctx)).entitled).toBe(true);
  });

  it("folds out-of-order events: subscription first, checkout binds the user after", async () => {
    const { svc, driver, identity, ctx } = await boot();
    driver.parsed.push(subUpdated("e1")); // no user known yet
    const early = await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    expect(early.roleChanged ?? false).toBe(false);
    expect(identity.setRolesCalls).toHaveLength(0);
    driver.parsed.push({ kind: "checkout.completed", eventId: "e2", customerId: "cus_1", userRef: "ada" });
    const late = await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    expect(late.roleChanged).toBe(true); // the stored active status projects now
    expect(identity.setRolesCalls[0]!.roles).toContain("member");
  });

  it("survives a missing identity service (mapping still updates, events still emit)", async () => {
    const engine = new Engine();
    const configPath = `/tmp/pattern-billing-test-${Math.random().toString(36).slice(2)}.json`;
    const mod = billingMod({ configPath });
    await engine.useAsync(mod, { deferReady: true });
    await mod.ready?.(engine);
    engine.provideService("storeService", fakeStore());
    const svc = engine.service<BillingService>(BILLING_SERVICE)!;
    const driver = fakeDriver();
    svc.registerDriver(driver.spec);
    const config = engine.service<BillingConfigService>("billingConfig")!;
    await config.upsertAccount({ name: "default", provider: "fake", secrets: { apiKey: { source: "env", key: "K" } }, options: {} });
    const ctx = {
      services: new Proxy({}, { get: (_t, p: string) => engine.service(p) ?? (p === "events" ? engine.events : undefined) }),
      env: { K: "x" },
      principal: { kind: "anonymous" },
    } as unknown as OpContext;
    let emitted: unknown;
    engine.events.subscribe("billing.subscription.updated", (p) => (emitted = p));
    driver.parsed.push(subUpdated("e1"));
    const res = await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    expect(res.ok).toBe(true);
    expect(emitted).toMatchObject({ account: "default", event: { kind: "subscription.updated" } });
  });
});

describe("checkout + usage", () => {
  it("builds redirect URLs from PATTERN_PUBLIC_URL and falls back to the account's default price", async () => {
    const { svc, driver, ctx } = await boot();
    const res = await svc.checkout({ userId: "ada", email: "ada@example.com" }, ctx);
    expect(res.url).toBe("https://pay.example/session_1");
    expect(driver.checkouts[0]).toMatchObject({
      mode: "subscription",
      priceKey: "price_pro",
      quantity: 1,
      successUrl: "https://app.example/billing/success",
      cancelUrl: "https://app.example/billing/cancel",
      userRef: "ada",
      email: "ada@example.com",
    });
  });

  it("records usage against the mapped customer", async () => {
    const { svc, driver, ctx } = await boot();
    driver.parsed.push({ kind: "checkout.completed", eventId: "e0", customerId: "cus_1", userRef: "ada" });
    await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    await svc.recordUsage({ userId: "ada", meter: "ai_tokens", value: 1234, identifier: "run-1" }, ctx);
    expect(driver.usage[0]).toMatchObject({ customerId: "cus_1", meter: "ai_tokens", value: 1234, identifier: "run-1" });
  });
});

describe("billing.event trigger", () => {
  it("a workflow on the trigger runs once per ingested event, filtered by kind", async () => {
    const { engine, svc, driver, ctx } = await boot();
    const seen: unknown[] = [];
    engine.registerOp({
      type: "t.collect",
      inputs: { kind: { kind: "value" }, userId: { kind: "value" } },
      outputs: { out: { kind: "value" } },
      execute: async (c) => {
        seen.push({ kind: await c.input.value("kind"), userId: await c.input.value("userId") });
        return { out: true };
      },
    });
    const wf: Workflow = {
      id: "on-payment-failed",
      nodes: [
        { id: "in", op: "billing.event", config: { kind: "invoice.payment_failed" } },
        { id: "spy", op: "t.collect" },
      ],
      edges: [
        { from: { node: "in", port: "kind" }, to: { node: "spy", port: "kind" } },
        { from: { node: "in", port: "userId" }, to: { node: "spy", port: "userId" } },
      ],
    } as Workflow;
    engine.registerWorkflow(wf);

    driver.parsed.push(subUpdated("e1")); // filtered out
    await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    driver.parsed.push({ kind: "invoice.payment_failed", eventId: "e2", customerId: "cus_1" });
    await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    await new Promise((r) => setTimeout(r, 50)); // the trigger run is fire-and-forget
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: "invoice.payment_failed" });
  });
});
