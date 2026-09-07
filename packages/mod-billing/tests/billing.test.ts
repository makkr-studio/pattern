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
import { checkoutCreateOp } from "../src/ops.js";
import {
  BILLING_SERVICE,
  BillingConfigService,
  billingMod,
  pageOps,
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
      async put(collection: string, id: string, data: Record<string, unknown>, expectedVersion?: number) {
        const existing = coll(collection).get(id);
        // CAS semantics like the real stores: a stale expected version loses.
        if (expectedVersion !== undefined && existing?.version !== expectedVersion) return null;
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
    secrets: [
      { field: "apiKey", label: "API key", required: true },
      { field: "webhookSecret", label: "Webhook secret", required: false },
    ],
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

async function boot(
  opts: { entitlement?: { role: string; gracePastDue?: boolean } | false; identity?: ReturnType<typeof fakeIdentity>; account?: false } = {},
) {
  const engine = new Engine({ env: { PATTERN_PUBLIC_URL: "https://app.example", FAKE_KEY: "sk_fake", FAKE_WHSEC: "whsec_fake" } });
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
  if (opts.account !== false) {
    await config.upsertAccount({
      name: "default",
      provider: "fake",
      secrets: { apiKey: { source: "env", key: "FAKE_KEY" } },
      options: { defaultPriceKey: "price_pro" },
    });
  }
  const ctx = {
    services: new Proxy({}, { get: (_t, p: string) => engine.service(p) ?? (p === "events" ? engine.events : undefined) }),
    env: { PATTERN_PUBLIC_URL: "https://app.example", FAKE_KEY: "sk_fake", FAKE_WHSEC: "whsec_fake" },
    principal: { kind: "anonymous" },
  } as unknown as OpContext;
  return { engine, svc, config, driver, store, identity, ctx };
}

const subUpdated = (eventId: string, status = "active", at?: number): BillingEvent => ({
  kind: "subscription.updated",
  eventId,
  customerId: "cus_1",
  subscriptionId: "sub_1",
  status: status as "active",
  priceKeys: ["price_pro"],
  ...(at !== undefined ? { at } : {}),
});
const subDeleted = (eventId: string, at?: number): BillingEvent => ({
  kind: "subscription.deleted",
  eventId,
  customerId: "cus_1",
  subscriptionId: "sub_1",
  ...(at !== undefined ? { at } : {}),
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

  it("a delivery that fails mid-projection is retryable, never a permanent duplicate", async () => {
    const { svc, driver, identity, store, ctx } = await boot();
    driver.parsed.push({ kind: "checkout.completed", eventId: "evt_0", customerId: "cus_1", userRef: "ada" });
    await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    // Identity hiccups exactly once, AFTER the event row exists.
    const real = identity.setRoles.bind(identity);
    let failOnce = true;
    identity.setRoles = async (userId: string, roles: string[]) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("identity down");
      }
      return real(userId, roles);
    };
    driver.parsed.push(subUpdated("evt_1"));
    await expect(svc.ingestEvent(new Uint8Array(), {}, "default", ctx)).rejects.toThrow("identity down");
    // The row says FAILED (not "seen") — and the role was never granted. (The
    // mapping row itself was written before the role step: a partial success
    // the retry converges, visible as `failed` in the admin meanwhile.)
    expect((await store.docs.get("billing.events", "fake:evt_1"))?.data).toMatchObject({ status: "failed", attempts: 1, error: "identity down" });
    expect(identity.users.get("ada")!.roles).not.toContain("member");
    // The provider redelivers → the SAME event id is reprocessed, not swallowed.
    driver.parsed.push(subUpdated("evt_1"));
    const retry = await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    expect(retry).toMatchObject({ ok: true, reprocessed: true, roleChanged: true });
    expect(retry.duplicate).toBeUndefined();
    expect((await store.docs.get("billing.events", "fake:evt_1"))?.data).toMatchObject({ status: "processed", attempts: 2 });
    expect((await svc.entitled({ userId: "ada" }, ctx)).entitled).toBe(true);
    expect(identity.users.get("ada")!.roles).toContain("member");
    // And NOW a redelivery is a duplicate.
    driver.parsed.push(subUpdated("evt_1"));
    expect(await svc.ingestEvent(new Uint8Array(), {}, "default", ctx)).toMatchObject({ ok: true, duplicate: true });
  });

  it("a concurrent delivery of the same event is refused (inflight), a stale claim is taken over", async () => {
    const { svc, driver, store, ctx } = await boot();
    // Someone else holds a FRESH claim → we must not acknowledge (the op answers 409).
    await store.docs.put("billing.events", "fake:evt_live", { status: "processing", attempts: 1, at: Date.now() });
    driver.parsed.push(subUpdated("evt_live"));
    expect(await svc.ingestEvent(new Uint8Array(), {}, "default", ctx)).toMatchObject({ ok: true, inflight: true });
    // A claim whose process died (stale) is ours to take over.
    await store.docs.put("billing.events", "fake:evt_stale", { status: "processing", attempts: 1, at: Date.now() - 120_000 });
    driver.parsed.push(subUpdated("evt_stale"));
    const taken = await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    expect(taken).toMatchObject({ ok: true, reprocessed: true });
    expect((await store.docs.get("billing.events", "fake:evt_stale"))?.data).toMatchObject({ status: "processed", attempts: 2 });
    // Rows from before delivery states existed count as processed.
    await store.docs.put("billing.events", "fake:evt_legacy", { provider: "fake", eventId: "evt_legacy", at: 1 });
    driver.parsed.push(subUpdated("evt_legacy"));
    expect(await svc.ingestEvent(new Uint8Array(), {}, "default", ctx)).toMatchObject({ ok: true, duplicate: true });
  });

  it("a delayed OLDER subscription event never resurrects a canceled subscription", async () => {
    const { svc, driver, identity, ctx } = await boot();
    driver.parsed.push({ kind: "checkout.completed", eventId: "e0", customerId: "cus_1", userRef: "ada" });
    await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    driver.parsed.push(subUpdated("e1", "active", 1_000));
    await svc.ingestEvent(new Uint8Array(), {}, "default", ctx); // grants
    driver.parsed.push(subDeleted("e2", 3_000));
    await svc.ingestEvent(new Uint8Array(), {}, "default", ctx); // revokes
    expect(identity.users.get("ada")!.roles).not.toContain("member");
    // The provider delivers an "active" that was CREATED before the deletion — late.
    driver.parsed.push(subUpdated("e3", "active", 2_000));
    const late = await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    expect(late).toMatchObject({ ok: true, stale: true });
    expect(late.roleChanged).toBeUndefined();
    expect(await svc.entitled({ userId: "ada" }, ctx)).toMatchObject({ entitled: false, status: "canceled" });
    expect(identity.users.get("ada")!.roles).not.toContain("member");
    // A genuinely newer event still applies (a re-subscription).
    driver.parsed.push(subUpdated("e4", "active", 4_000));
    expect((await svc.ingestEvent(new Uint8Array(), {}, "default", ctx)).roleChanged).toBe(true);
    // Events without a provider time (drivers that don't report one) keep arrival order.
    driver.parsed.push(subDeleted("e5"));
    expect((await svc.ingestEvent(new Uint8Array(), {}, "default", ctx)).roleChanged).toBe(true);
  });

  it("deliveries for the SAME customer are serialized — no interleaved read-modify-write", async () => {
    const { svc, driver, identity, ctx } = await boot();
    driver.parsed.push({ kind: "checkout.completed", eventId: "e0", customerId: "cus_1", userRef: "ada" });
    await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    // Make the projection slow enough to interleave without a lock.
    const realGet = identity.getUser.bind(identity);
    identity.getUser = async (id: string) => {
      await new Promise((r) => setTimeout(r, 10));
      return realGet(id);
    };
    driver.parsed.push(subUpdated("e1", "active", 1_000), subDeleted("e2", 2_000));
    const [a, b] = await Promise.all([
      svc.ingestEvent(new Uint8Array(), {}, "default", ctx),
      svc.ingestEvent(new Uint8Array(), {}, "default", ctx),
    ]);
    expect(a.roleChanged).toBe(true); // granted
    expect(b.roleChanged).toBe(true); // revoked — it saw the grant, not a stale snapshot
    expect(identity.setRolesCalls.map((c) => c.roles)).toEqual([["admin", "member"], ["admin"]]);
    expect(await svc.entitled({ userId: "ada" }, ctx)).toMatchObject({ entitled: false, status: "canceled" });
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

/* ── friendly unavailability + the setup checklist ────────────────────── */

/** in → op → boundary.http.status → { status, body } on the return value. */
const outcomeWf = (id: string, op: string, inputs: Array<[string, string]>): Workflow =>
  ({
    id,
    nodes: [
      { id: "in", op: "boundary.manual", config: { outputs: inputs.map(([port]) => port) } },
      { id: "call", op },
      { id: "status", op: "boundary.http.status" },
      { id: "shape", op: "core.object.build", config: { keys: ["status", "body"] } },
      { id: "out", op: "boundary.return" },
    ],
    edges: [
      ...inputs.map(([port, to]) => ({ from: { node: "in", port }, to: { node: "call", port: to } })),
      { from: { node: "call", port: "result" }, to: { node: "status", port: "result" } },
      { from: { node: "status", port: "status" }, to: { node: "shape", port: "status" } },
      { from: { node: "status", port: "body" }, to: { node: "shape", port: "body" } },
      { from: { node: "shape", port: "out" }, to: { node: "out", port: "value" } },
    ],
  }) as Workflow;

describe("setup-shaped failures are outcomes, not failed runs", () => {
  it("an unconfigured checkout answers 409 billing_not_configured — and the run stays green", async () => {
    const { engine } = await boot({ account: false });
    engine.registerWorkflow(outcomeWf("co", "billing.checkout.create", [["userId", "userId"]]));
    const res = await engine.run("co", { input: { userId: "ada" } });
    expect(res.status).toBe("ok"); // no failed run, no failure alert
    const v = (Object.values(res.outputs)[0] as { value: { status: number; body: Record<string, unknown> } }).value;
    expect(v.status).toBe(409);
    expect(v.body.error).toBe("billing_not_configured");
    expect(String(v.body.message)).toContain("admin");
  });

  it("the portal before any subscription answers 409 billing_no_customer", async () => {
    const { engine } = await boot();
    engine.registerWorkflow(outcomeWf("po", "billing.portal.create", [["userId", "userId"]]));
    const res = await engine.run("po", { input: { userId: "nobody" } });
    expect(res.status).toBe("ok");
    const v = (Object.values(res.outputs)[0] as { value: { status: number; body: Record<string, unknown> } }).value;
    expect(v.status).toBe(409);
    expect(v.body.error).toBe("billing_no_customer");
  });

  it("a configured checkout still reports { url } through result (and seals retries per run+node)", async () => {
    const { engine, driver } = await boot();
    engine.registerWorkflow(outcomeWf("ok", "billing.checkout.create", [["userId", "userId"]]));
    const res = await engine.run("ok", { input: { userId: "ada" } });
    expect(res.status).toBe("ok");
    const v = (Object.values(res.outputs)[0] as { value: { status: number; body: Record<string, unknown> } }).value;
    expect(v.status).toBe(200);
    expect(v.body.url).toBe("https://pay.example/session_1");
    // The provider retry seal is pinned to run+node — stable, not random.
    expect(String(driver.checkouts[0]!.idempotencyKey)).toContain(res.runId);
  });

  it("the retry seal follows the run LINEAGE: a resumed run keeps the original run's key", async () => {
    // Resume hands ops `ctx.rootRunId` = the first run of the chain. Pinning
    // the provider idempotency key to it means a node re-executed by a resume
    // REPLAYS the provider's stored response — no second checkout session, no
    // second charge — while a re-run from start (its own root) gets a new key.
    const { driver, ctx } = await boot();
    const opCtx = (runId: string, rootRunId: string) =>
      ({
        ...ctx,
        config: { account: "default", mode: "subscription" },
        runId,
        rootRunId,
        nodeId: "checkout",
        input: { has: () => false, value: async () => undefined, stream: () => new ReadableStream() },
      }) as unknown as OpContext;
    await checkoutCreateOp.execute(opCtx("run-1", "run-1"));
    await checkoutCreateOp.execute(opCtx("run-2-resumed", "run-1"));
    await checkoutCreateOp.execute(opCtx("run-3-fresh", "run-3-fresh"));
    expect(driver.checkouts.map((c) => c.idempotencyKey)).toEqual(["run-1:checkout", "run-1:checkout", "run-3-fresh:checkout"]);
  });
});

describe("billing.admin.status — the checklist tells the truth", () => {
  const statusWf: Workflow = {
    id: "st",
    nodes: [
      { id: "in", op: "boundary.manual" },
      { id: "s", op: "billing.admin.status" },
      { id: "out", op: "boundary.return" },
    ],
    edges: [
      { from: { node: "in", port: "out" }, to: { node: "s", port: "in" } },
      { from: { node: "s", port: "status" }, to: { node: "out", port: "value" } },
    ],
  } as Workflow;
  type Status = {
    drivers: Array<{ id: string }>;
    account: { missingSecrets: string[]; hasWebhookSecret: boolean; defaultPriceKey: string } | null;
    webhookUrl: string;
    lastEvent: { kind: string } | null;
  };
  const read = async (engine: Engine): Promise<Status> => {
    const res = await engine.run("st", { input: {} });
    return (Object.values(res.outputs)[0] as { value: Status }).value;
  };

  it("walks no-account → account → webhook secret → first event", async () => {
    const { engine, svc, config, driver, ctx } = await boot({ account: false });
    engine.registerWorkflow(statusWf);

    let st = await read(engine);
    expect(st.drivers.map((d) => d.id)).toContain("fake");
    expect(st.account).toBeNull();
    expect(st.webhookUrl).toBe("https://app.example/billing/webhook/fake");
    expect(st.lastEvent).toBeNull();

    await config.upsertAccount({ name: "default", provider: "fake", secrets: { apiKey: { source: "env", key: "FAKE_KEY" } }, options: {} });
    st = await read(engine);
    expect(st.account).toMatchObject({ missingSecrets: [], hasWebhookSecret: false, defaultPriceKey: "" });

    await config.upsertAccount({
      name: "default",
      provider: "fake",
      secrets: { apiKey: { source: "env", key: "FAKE_KEY" }, webhookSecret: { source: "env", key: "FAKE_WHSEC" } },
      options: { defaultPriceKey: "price_pro" },
    });
    st = await read(engine);
    expect(st.account).toMatchObject({ hasWebhookSecret: true, defaultPriceKey: "price_pro" });

    driver.parsed.push({ kind: "checkout.completed", eventId: "e_st", customerId: "cus_1", userRef: "ada" });
    await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    st = await read(engine);
    expect(st.lastEvent).toMatchObject({ kind: "checkout.completed" });
  });
});


describe("the return pages absorb the webhook race", () => {
  // The pure page ops never see HTTP — a hand-rolled ctx is the whole harness.
  const pageCtx = (
    services: OpContext["services"],
    principal: unknown,
    inputs: Record<string, unknown> = {},
    config: unknown = {},
  ): OpContext =>
    ({
      services,
      principal,
      config,
      input: {
        has: (p: string) => p in inputs,
        value: async (p: string) => inputs[p],
        stream: () => {
          throw new Error("unused");
        },
      },
    }) as unknown as OpContext;

  const opByType = (type: string) => {
    const op = pageOps.find((o) => o.type === type)!;
    expect(op).toBeDefined();
    return op;
  };

  it("checkout threads `next` onto BOTH return URLs, open-redirect guarded", async () => {
    const { svc, driver, ctx } = await boot();
    await svc.checkout({ next: "/pro" }, ctx);
    expect(driver.checkouts[0]).toMatchObject({
      successUrl: "https://app.example/billing/success?next=%2Fpro",
      cancelUrl: "https://app.example/billing/cancel?next=%2Fpro",
    });
    await svc.checkout({ next: "https://evil.example/phish" }, ctx);
    expect(driver.checkouts[1]!.successUrl).toBe("https://app.example/billing/success?next=%2F");
  });

  it("success page: anonymous thank-you / signed-in poller / entitled redirect", async () => {
    const { svc, driver, ctx } = await boot();
    const success = opByType("billing.success.page");
    const cfg = { statusPath: "/billing/status" };

    const anon = (await success.execute(pageCtx(ctx.services, { kind: "anonymous" }, { next: "/pro" }, cfg))) as {
      body?: string;
      redirect?: string;
    };
    expect(anon.redirect).toBeUndefined();
    expect(anon.body).toContain("Payment received");
    expect(anon.body).toContain('href="/pro"');
    expect(anon.body).not.toContain("fetch(");

    const waiting = (await success.execute(
      pageCtx(ctx.services, { kind: "user", id: "ada", provider: "test" }, { next: "/pro" }, cfg),
    )) as { body?: string; redirect?: string };
    expect(waiting.redirect).toBeUndefined();
    expect(waiting.body).toContain("Unlocking your account");
    expect(waiting.body).toContain('"/billing/status"'); // the poller target
    expect(waiting.body).toContain('"/pro"'); // the forward destination

    // The webhook lands → the same request now redirects straight through.
    driver.parsed.push({ kind: "checkout.completed", eventId: "e0", customerId: "cus_1", userRef: "ada" });
    await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    driver.parsed.push(subUpdated("e1"));
    await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    const entitled = (await success.execute(
      pageCtx(ctx.services, { kind: "user", id: "ada", provider: "test" }, { next: "/pro" }, cfg),
    )) as { redirect?: string };
    expect(entitled.redirect).toBe("/pro");
  });

  it("status.mine is principal-derived — anonymous stays blank, no userId input exists", async () => {
    const { svc, driver, ctx } = await boot();
    const status = opByType("billing.status.mine");
    expect(Object.keys(status.inputs)).toHaveLength(0);

    const anon = (await status.execute(pageCtx(ctx.services, { kind: "anonymous" }))) as { state: Record<string, unknown> };
    expect(anon.state).toEqual({ signedIn: false, entitled: false });

    driver.parsed.push({ kind: "checkout.completed", eventId: "e0", customerId: "cus_1", userRef: "ada" });
    await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    driver.parsed.push(subUpdated("e1"));
    await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    const mine = (await status.execute(pageCtx(ctx.services, { kind: "user", id: "ada", provider: "test" }))) as {
      state: Record<string, unknown>;
    };
    expect(mine.state).toEqual({ signedIn: true, entitled: true, status: "active" });
  });

  it("cancel page reassures and points back", async () => {
    const { ctx } = await boot();
    const cancel = opByType("billing.cancel.page");
    const out = (await cancel.execute(pageCtx(ctx.services, { kind: "anonymous" }, { next: "/pricing" }))) as { body?: string };
    expect(out.body).toContain("No charge was made");
    expect(out.body).toContain('href="/pricing"');
  });

  it("the routes are seeded by default, movable, and removable", async () => {
    const { engine } = await boot();
    expect(engine.workflows.get("billing.route.success")).toBeDefined();
    expect(engine.workflows.get("billing.route.cancel")).toBeDefined();
    expect(engine.workflows.get("billing.route.status.mine")).toBeDefined();
    // The success page's poller is configured with the status route's path.
    const call = engine.workflows.get("billing.route.success")!.nodes.find((n) => n.id === "call")!;
    expect(call.config).toMatchObject({ statusPath: "/billing/status" });

    const bare = new Engine({ env: {} });
    await bare.useAsync(billingMod({ configPath: `/tmp/pattern-billing-test-${Math.random().toString(36).slice(2)}.json`, pages: false }), { deferReady: true });
    expect(bare.workflows.get("billing.route.success")).toBeUndefined();
    expect(bare.workflows.get("billing.route.status.mine")).toBeUndefined();
  });
});

describe("billing.admin.checklist — server-owned steps for page + dashboard", () => {
  it("normalizes the status into steps that tick, with the copy baked in", async () => {
    const { engine, svc, config, driver, ctx } = await boot({ account: false });
    engine.registerWorkflow({
      id: "cl",
      nodes: [
        { id: "in", op: "boundary.manual" },
        { id: "c", op: "billing.admin.checklist" },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "out" }, to: { node: "c", port: "in" } },
        { from: { node: "c", port: "checklist" }, to: { node: "out", port: "value" } },
      ],
    } as Workflow);
    const read = async () => {
      const res = await engine.run("cl", { input: {} });
      return (Object.values(res.outputs)[0] as { value: { steps: Array<{ ok: boolean; label: string; how?: string }>; done: boolean } }).value;
    };

    let cl = await read();
    expect(cl.done).toBe(false);
    expect(cl.steps.map((s) => s.ok)).toEqual([true, false, false, false, false, false]);
    // The next-action copy rides server-side (the webhook URL is baked in).
    expect(cl.steps[4]!.how).toContain("stripe listen --forward-to https://app.example/billing/webhook/fake");

    await config.upsertAccount({
      name: "default",
      provider: "fake",
      secrets: { apiKey: { source: "env", key: "FAKE_KEY" }, webhookSecret: { source: "env", key: "FAKE_WHSEC" } },
      options: { defaultPriceKey: "price_pro" },
    });
    driver.parsed.push({ kind: "checkout.completed", eventId: "e_cl", customerId: "cus_1", userRef: "ada" });
    await svc.ingestEvent(new Uint8Array(), {}, "default", ctx);
    cl = await read();
    expect(cl.done).toBe(true);
    expect(cl.steps[5]!).toMatchObject({ ok: true });
  });
});
