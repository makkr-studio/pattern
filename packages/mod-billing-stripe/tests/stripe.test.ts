/**
 * The Stripe driver, end to end against a fake Stripe API: the form encoding
 * Stripe actually parses, the signature scheme it actually uses (hex HMAC
 * over `${t}.${raw}`, whsec used VERBATIM — not the svix routine), the
 * webhook → mapping → role pipeline over real HTTP, redelivery dedup, and
 * the portal configuration created exactly once.
 *
 * Ports: 5210 (fake Stripe API), 5211 (the app). Never 5060/5061.
 */
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Engine, type OpContext, type Workflow } from "@pattern-js/core";
import { createHttpHost } from "@pattern-js/runtime-node";
import { BILLING_SERVICE, BillingConfigService, billingMod, type BillingService } from "@pattern-js/mod-billing";
import { formEncode, resetPortalCache, stripeBillingMod, verifyStripeSignature } from "@pattern-js/mod-billing-stripe";

const STRIPE_PORT = 5210;
const APP_PORT = 5211;
const SECRET = "whsec_test_secret_1234567890";

/* ── unit: the form encoding Stripe parses ────────────────────────────── */

describe("formEncode", () => {
  it("encodes nested objects, arrays, and booleans the bracket way", () => {
    expect(
      formEncode({
        mode: "subscription",
        line_items: [{ price: "price_123", quantity: 1 }],
        metadata: { user: "ada" },
        active: true,
      }),
    ).toBe(
      "mode=subscription&line_items%5B0%5D%5Bprice%5D=price_123&line_items%5B0%5D%5Bquantity%5D=1&metadata%5Buser%5D=ada&active=true",
    );
  });

  it("drops null/undefined and stringifies numbers", () => {
    expect(formEncode({ a: 1, b: undefined, c: null, d: "x y" })).toBe("a=1&d=x%20y");
  });
});

/* ── unit: the signature scheme ───────────────────────────────────────── */

const sign = (body: string | Uint8Array, t = Math.floor(Date.now() / 1000), secret = SECRET): string => {
  const payload = typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
  const sig = createHmac("sha256", secret).update(Buffer.concat([Buffer.from(`${t}.`, "utf8"), payload])).digest("hex");
  return `t=${t},v1=${sig}`;
};

describe("verifyStripeSignature", () => {
  const payload = new TextEncoder().encode('{"id":"evt_1","type":"invoice.paid"}');

  it("accepts a valid hex HMAC over t.body with the whsec secret verbatim", () => {
    expect(verifyStripeSignature({ secret: SECRET, header: sign(payload), payload })).toBe(true);
  });

  it("rejects a tampered body", () => {
    const tampered = new TextEncoder().encode('{"id":"evt_1","type":"invoice.paid" }');
    expect(verifyStripeSignature({ secret: SECRET, header: sign(payload), payload: tampered })).toBe(false);
  });

  it("rejects a stale timestamp (±300s tolerance)", () => {
    const old = Math.floor(Date.now() / 1000) - 600;
    expect(verifyStripeSignature({ secret: SECRET, header: sign(payload, old), payload })).toBe(false);
  });

  it("ignores v0 — a v0-only header is a downgrade attack, not a signature", () => {
    const t = Math.floor(Date.now() / 1000);
    const v0 = createHmac("sha256", SECRET).update(`${t}.${Buffer.from(payload).toString("utf8")}`).digest("hex");
    expect(verifyStripeSignature({ secret: SECRET, header: `t=${t},v0=${v0}`, payload })).toBe(false);
  });

  it("accepts when ANY v1 matches (secret rotation ships two)", () => {
    const t = Math.floor(Date.now() / 1000);
    const good = sign(payload, t).split("v1=")[1]!;
    const header = `t=${t},v1=${"0".repeat(64)},v1=${good}`;
    expect(verifyStripeSignature({ secret: SECRET, header, payload })).toBe(true);
  });
});

/* ── the fake Stripe API ──────────────────────────────────────────────── */

interface Captured {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

function fakeStripe(): { server: Server; requests: Captured[]; configs: string[]; flaky: { failCheckouts: number } } {
  const requests: Captured[] = [];
  const configs: string[] = [];
  const flaky = { failCheckouts: 0 };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const path = req.url ?? "";
      requests.push({
        method: req.method ?? "",
        path,
        headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])),
        body,
      });
      const json = (v: unknown): void => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(v));
      };
      if (path.startsWith("/v1/checkout/sessions")) {
        if (flaky.failCheckouts > 0) {
          flaky.failCheckouts--;
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { type: "api_error", message: "transient blip" } }));
          return;
        }
        return json({ id: "cs_test_1", url: "https://checkout.stripe.example/cs_test_1" });
      }
      if (path.startsWith("/v1/billing_portal/configurations") && req.method === "GET") {
        return json({ data: configs.map((id) => ({ id })) });
      }
      if (path.startsWith("/v1/billing_portal/configurations") && req.method === "POST") {
        configs.push(`bpc_${configs.length + 1}`);
        return json({ id: configs.at(-1) });
      }
      if (path.startsWith("/v1/billing_portal/sessions")) return json({ url: "https://billing.stripe.example/p/1" });
      if (path.startsWith("/v1/billing/meter_events")) return json({ identifier: "ok" });
      if (path.startsWith("/v1/subscriptions/")) {
        return json({
          id: path.split("/").at(-1),
          customer: "cus_42",
          status: "active",
          items: { data: [{ price: { id: "price_pro", lookup_key: "pro" } }] },
        });
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { type: "invalid_request_error", message: `no fake for ${path}` } }));
    });
  });
  return { server, requests, configs, flaky };
}

/* ── fakes for the sibling services ───────────────────────────────────── */

function fakeStore() {
  const collections = new Map<string, Map<string, { id: string; data: Record<string, unknown>; version: number; createdAt: number; updatedAt: number }>>();
  const coll = (name: string) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name)!;
  };
  return {
    docs: {
      async ensureCollection() {},
      async get(c: string, id: string) {
        const row = coll(c).get(id);
        return row ? { ...row, data: { ...row.data } } : null;
      },
      async put(c: string, id: string, data: Record<string, unknown>) {
        const existing = coll(c).get(id);
        const row = { id, data, version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now() };
        coll(c).set(id, row);
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

function fakeIdentity() {
  const users = new Map([["ada", { id: "ada", roles: ["admin"] }]]);
  const setRolesCalls: string[][] = [];
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
      setRolesCalls.push([...roles]);
      const u = users.get(userId);
      if (u) u.roles = [...roles];
      return u;
    },
  };
}

/* ── e2e harness ──────────────────────────────────────────────────────── */

let stripe: ReturnType<typeof fakeStripe>;
let appEngine: Engine;
let closeApp: (() => Promise<void>) | undefined;
let svc: BillingService;
let identity: ReturnType<typeof fakeIdentity>;
let store: ReturnType<typeof fakeStore>;
let opCtx: OpContext;

beforeAll(async () => {
  resetPortalCache();
  stripe = fakeStripe();
  await new Promise<void>((r) => stripe.server.listen(STRIPE_PORT, r));

  const engine = new Engine({ env: { PATTERN_PUBLIC_URL: "https://app.example", STRIPE_KEY: "sk_test_x", STRIPE_WHSEC: SECRET } });
  appEngine = engine;
  const billing = billingMod({ configPath: `/tmp/pattern-billing-stripe-test-${Date.now()}.json` });
  const stripeMod = stripeBillingMod();
  await engine.useAsync(billing, { deferReady: true });
  await engine.useAsync(stripeMod, { deferReady: true });
  await billing.ready?.(engine);
  await stripeMod.ready?.(engine);

  store = fakeStore();
  identity = fakeIdentity();
  engine.provideService("storeService", store);
  engine.provideService("identityService", identity);

  const config = engine.service<BillingConfigService>("billingConfig")!;
  await config.upsertAccount({
    name: "default",
    provider: "stripe",
    secrets: {
      apiKey: { source: "env", key: "STRIPE_KEY" },
      webhookSecret: { source: "env", key: "STRIPE_WHSEC" },
    },
    options: { apiBase: `http://localhost:${STRIPE_PORT}`, defaultPriceKey: "price_pro" },
  });
  svc = engine.service<BillingService>(BILLING_SERVICE)!;
  opCtx = {
    services: new Proxy({}, { get: (_t, p: string) => engine.service(p) ?? (p === "events" ? engine.events : undefined) }),
    env: { PATTERN_PUBLIC_URL: "https://app.example", STRIPE_KEY: "sk_test_x", STRIPE_WHSEC: SECRET },
    principal: { kind: "anonymous" },
  } as unknown as OpContext;

  const { close } = await createHttpHost(engine, { defaultPort: APP_PORT }).start();
  closeApp = close;
});

afterAll(async () => {
  await closeApp?.();
  await new Promise((r) => stripe.server.close(r));
});

const webhookUrl = `http://localhost:${APP_PORT}/billing/webhook/stripe`;

const checkoutCompleted = JSON.stringify({
  id: "evt_checkout_1",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_1",
      customer: "cus_42",
      subscription: "sub_42",
      client_reference_id: "ada",
      payment_status: "paid",
      customer_details: { email: "ada@example.com" },
    },
  },
});

const subscriptionActive = JSON.stringify({
  id: "evt_sub_1",
  type: "customer.subscription.updated",
  data: {
    object: {
      id: "sub_42",
      customer: "cus_42",
      status: "active",
      items: { data: [{ price: { id: "price_pro", lookup_key: "pro" } }] },
    },
  },
});

describe("the seeded webhook route (raw bytes end to end)", () => {
  it("verifies a REAL signature, maps the customer, and projects the role", async () => {
    const r1 = await fetch(webhookUrl, { method: "POST", headers: { "stripe-signature": sign(checkoutCompleted) }, body: checkoutCompleted });
    expect(r1.status).toBe(200);
    const r2 = await fetch(webhookUrl, { method: "POST", headers: { "stripe-signature": sign(subscriptionActive) }, body: subscriptionActive });
    expect(r2.status).toBe(200);
    expect(await r2.json()).toMatchObject({ ok: true, kind: "subscription.updated" });

    const rows = await store.docs.query({ collection: "billing.customers" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data).toMatchObject({ userId: "ada", customerId: "cus_42", status: "active", entitled: true });
    expect(identity.users.get("ada")!.roles).toContain("member");
    expect(identity.setRolesCalls).toHaveLength(1);
  });

  it("a redelivery of the same event id is acknowledged but never re-projected", async () => {
    const res = await fetch(webhookUrl, { method: "POST", headers: { "stripe-signature": sign(subscriptionActive) }, body: subscriptionActive });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, duplicate: true });
    expect(identity.setRolesCalls).toHaveLength(1); // unchanged
  });

  it("rejects a bad signature with 401 — the signature IS the gate", async () => {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "stripe-signature": sign(subscriptionActive, undefined, "whsec_wrong") },
      body: subscriptionActive,
    });
    expect(res.status).toBe(401);
  });
});

describe("the client against the fake API", () => {
  it("checkout sends bracket-encoded form data with an Idempotency-Key", async () => {
    const res = await svc.checkout({ userId: "ada", email: "ada@example.com" }, opCtx);
    expect(res.url).toBe("https://checkout.stripe.example/cs_test_1");
    const req = stripe.requests.find((r) => r.path.startsWith("/v1/checkout/sessions"))!;
    expect(req.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(req.headers["stripe-version"]).toBe("2026-06-24.dahlia");
    expect(req.headers["idempotency-key"]).toMatch(/[0-9a-f-]{36}/);
    expect(req.body).toContain("mode=subscription");
    expect(req.body).toContain("line_items%5B0%5D%5Bprice%5D=price_pro");
    expect(req.body).toContain("client_reference_id=ada");
    // The existing mapping wins over customer_email.
    expect(req.body).toContain("customer=cus_42");
    expect(req.body).toContain(encodeURIComponent("https://app.example/billing/success"));
  });

  it("the portal creates its configuration exactly once across calls", async () => {
    await svc.portal({ userId: "ada" }, opCtx);
    await svc.portal({ userId: "ada" }, opCtx);
    const creates = stripe.requests.filter((r) => r.method === "POST" && r.path.startsWith("/v1/billing_portal/configurations"));
    expect(creates).toHaveLength(1);
    expect(stripe.configs).toHaveLength(1);
  });

  it("records meter events against the mapped customer", async () => {
    await svc.recordUsage({ userId: "ada", meter: "ai_tokens", value: 512, identifier: "run-9" }, opCtx);
    const req = stripe.requests.find((r) => r.path.startsWith("/v1/billing/meter_events"))!;
    expect(req.body).toContain("event_name=ai_tokens");
    expect(req.body).toContain("payload%5Bstripe_customer_id%5D=cus_42");
    expect(req.body).toContain("payload%5Bvalue%5D=512");
    expect(req.body).toContain("identifier=run-9");
  });

  it("subscription.get reads the provider fresh", async () => {
    const sub = await svc.subscription({ userId: "ada" }, opCtx);
    expect(sub).toMatchObject({ status: "active", entitled: true, priceKeys: ["pro"], customerId: "cus_42" });
  });
});

describe("the retry seal — one key, one session, however many attempts", () => {
  it("a per-node retry replays the SAME Idempotency-Key after a 500", async () => {
    appEngine.registerWorkflow({
      id: "retrying-checkout",
      durable: true,
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["userId"] } },
        { id: "checkout", op: "billing.checkout.create", retry: { attempts: 3, backoffMs: 1 } },
        { id: "status", op: "boundary.http.status" },
        { id: "shape", op: "core.object.build", config: { keys: ["status", "body"] } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "userId" }, to: { node: "checkout", port: "userId" } },
        { from: { node: "checkout", port: "result" }, to: { node: "status", port: "result" } },
        { from: { node: "status", port: "status" }, to: { node: "shape", port: "status" } },
        { from: { node: "status", port: "body" }, to: { node: "shape", port: "body" } },
        { from: { node: "shape", port: "out" }, to: { node: "out", port: "value" } },
      ],
    } as Workflow);

    const before = stripe.requests.filter((r) => r.path.startsWith("/v1/checkout/sessions")).length;
    stripe.flaky.failCheckouts = 1; // first attempt 500s; the retry must land
    const res = await appEngine.run("retrying-checkout", { input: { userId: "ada" } });
    expect(res.status).toBe("ok");
    const v = (Object.values(res.outputs)[0] as { value: { status: number; body: { url?: string } } }).value;
    expect(v.status).toBe(200);
    expect(v.body.url).toContain("checkout.stripe.example");

    const calls = stripe.requests.filter((r) => r.path.startsWith("/v1/checkout/sessions")).slice(before);
    expect(calls).toHaveLength(2); // the 500 + the successful retry
    const keys = calls.map((c) => c.headers["idempotency-key"]);
    expect(keys[0]).toBe(keys[1]); // the whole point: Stripe replays, never duplicates
    expect(String(keys[0])).toContain(res.runId); // pinned to run+node, not random
  });
});

