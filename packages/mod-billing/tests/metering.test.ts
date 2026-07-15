import { describe, expect, it } from "vitest";
import { Engine } from "@pattern-js/core";
import { billingMod } from "../src/mod.js";
import { BILLING_SERVICE } from "../src/well-known.js";
import { CUSTOMERS_COLLECTION, type BillingService } from "../src/service.js";
import type { BillingDriverSpec } from "../src/types.js";

/**
 * The packaged metering loop end-to-end: mod-ai's `ai.usage` event → the
 * seeded `billing.meter.ai-usage` workflow → the driver's meter. Attributed,
 * measured calls record; guests and token-less reports gate out silently.
 */

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
        const row = { id, data, version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now() };
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

function meterDriver() {
  const usage: Array<Record<string, unknown>> = [];
  const spec: BillingDriverSpec = {
    id: "fake",
    label: "Fake Pay",
    secrets: [{ field: "apiKey", label: "API key", required: true }],
    options: [],
    async createCheckout() {
      return { url: "https://pay.example/x", sessionId: "cs" };
    },
    async createPortal() {
      return { url: "https://pay.example/p" };
    },
    async getSubscription(subscriptionId: string) {
      return { subscriptionId, customerId: "cus_1", status: "active" as const, priceKeys: [] };
    },
    async recordUsage(evt) {
      usage.push({ ...evt });
    },
    async verifyAndParse() {
      return null;
    },
  };
  return { spec, usage };
}

async function until<T>(read: () => T, ok: (v: T) => boolean, ms = 2000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = read();
    if (ok(v)) return v;
    if (Date.now() - start > ms) return v;
    await new Promise((r) => setTimeout(r, 15));
  }
}

async function boot(meterAiUsage: boolean) {
  const engine = new Engine({ env: { FAKE_KEY: "sk" } });
  const configPath = `/tmp/pattern-metering-test-${Math.random().toString(36).slice(2)}.json`;
  const mod = billingMod({ configPath, meterAiUsage, aiMeter: "ai_tokens" });
  await engine.useAsync(mod);
  const store = fakeStore();
  engine.provideService("storeService", store);
  const svc = engine.service<BillingService>(BILLING_SERVICE)!;
  const driver = meterDriver();
  svc.registerDriver(driver.spec);
  const config = engine.service<{ upsertAccount: (a: unknown) => Promise<unknown> }>("billingConfig")!;
  await config.upsertAccount({
    name: "default",
    provider: "fake",
    secrets: { apiKey: { source: "env", key: "FAKE_KEY" } },
    options: {},
  });
  // A known billing customer for ada — the meter records against it.
  await store.docs.put(CUSTOMERS_COLLECTION, "cus_ada", {
    userId: "ada",
    customerId: "cus_ada",
    provider: "fake",
    status: "active",
    updatedAt: Date.now(),
  });
  return { engine, driver };
}

describe("billing.meter.ai-usage (the packaged metering workflow)", () => {
  it("records attributed, measured ai.usage events onto the meter", async () => {
    const { engine, driver } = await boot(true);
    engine.emit("ai.usage", {
      modelId: "fake-mini",
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      userId: "ada",
      runId: "r1",
      workflowId: "w1",
      nodeId: "n1",
    });
    const rows = await until(
      () => driver.usage,
      (u) => u.length > 0,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ customerId: "cus_ada", meter: "ai_tokens", value: 150 });
  });

  it("gates out guest calls and token-less reports instead of erroring", async () => {
    const { engine, driver } = await boot(true);
    engine.emit("ai.usage", { modelId: "m", totalTokens: 99, runId: "r", workflowId: "w", nodeId: "n" }); // no user
    engine.emit("ai.usage", { modelId: "m", userId: "ada", runId: "r", workflowId: "w", nodeId: "n" }); // no tokens
    await new Promise((r) => setTimeout(r, 150));
    expect(driver.usage).toHaveLength(0);
  });

  it("is absent entirely unless meterAiUsage is on", async () => {
    const { engine, driver } = await boot(false);
    engine.emit("ai.usage", { modelId: "m", userId: "ada", totalTokens: 9, runId: "r", workflowId: "w", nodeId: "n" });
    await new Promise((r) => setTimeout(r, 150));
    expect(driver.usage).toHaveLength(0);
  });
});
