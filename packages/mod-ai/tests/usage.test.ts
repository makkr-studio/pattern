import { describe, expect, it, vi } from "vitest";
import type { OpContext } from "@pattern-js/core";
import { withUsageTap, type AiUsageEvent } from "../src/usage.js";

/**
 * The metering tap in isolation: wrap a hand-rolled V3 model, drive its
 * doGenerate/doStream directly (exactly what the AI SDK does), and watch the
 * span attributes + `ai.usage` events. Fail-open is part of the contract.
 */

const V3_USAGE = { inputTokens: { total: 120 }, outputTokens: { total: 30 } };

function fakeV3Model(spec: "v3" | "v4" = "v3") {
  return {
    specificationVersion: spec,
    provider: "fake",
    modelId: "fake-mini",
    supportedUrls: {},
    doGenerate: async () => ({ content: [], finishReason: "stop", usage: V3_USAGE, warnings: [] }),
    doStream: async () => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: "text-delta", id: "1", delta: "hi" });
          c.enqueue({ type: "finish", usage: V3_USAGE, finishReason: "stop" });
          c.close();
        },
      }),
    }),
  };
}

function fakeCtx(opts: { user?: string; throwOnEmit?: boolean } = {}) {
  const events: Array<{ event: string; payload: AiUsageEvent }> = [];
  const attrs: Record<string, unknown> = {};
  const ctx = {
    runId: "run-1",
    workflowId: "wf-1",
    nodeId: "node-1",
    principal: opts.user ? { kind: "user", id: opts.user, provider: "test" } : { kind: "anonymous" },
    trace: {
      setAttributes: (a: Record<string, unknown>) => Object.assign(attrs, a),
      setAttribute: (k: string, v: unknown) => (attrs[k] = v),
      addEvent: () => {},
    },
    services: {
      events: {
        emit: (event: string, payload: unknown) => {
          if (opts.throwOnEmit) throw new Error("bus is down");
          events.push({ event, payload: payload as AiUsageEvent });
        },
        subscribe: () => () => {},
      },
    },
  } as unknown as OpContext;
  return { ctx, events, attrs };
}

describe("withUsageTap", () => {
  it("taps v4-spec models (ai@7's own providers) exactly like v3 — and warns once for a spec it can't read", async () => {
    const { ctx, events } = fakeCtx({ user: "ada" });
    const v4 = withUsageTap(fakeV3Model("v4") as never, ctx) as { doGenerate: (p: unknown) => Promise<unknown> };
    await v4.doGenerate({ prompt: [] });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ modelId: "fake-mini", inputTokens: 120, outputTokens: 30, totalTokens: 150, userId: "ada" });

    // An unknown spec passes through untapped — no throw, no event, one warning.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const future = { ...fakeV3Model(), specificationVersion: "v9" };
      const untapped = withUsageTap(future as never, ctx) as { doGenerate: (p: unknown) => Promise<unknown> };
      expect(untapped).toBe(future); // returned as-is
      withUsageTap({ ...fakeV3Model(), specificationVersion: "v9" } as never, ctx);
      expect(warn.mock.calls.filter((c) => /NOT metered/.test(String(c[0])))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("taps doGenerate: span attributes + an attributed ai.usage event", async () => {
    const { ctx, events, attrs } = fakeCtx({ user: "ada" });
    const model = withUsageTap(fakeV3Model() as never, ctx) as { doGenerate: (p: unknown) => Promise<unknown> };
    await model.doGenerate({ prompt: [] });
    expect(attrs["ai.modelId"]).toBe("fake-mini");
    expect(attrs["ai.totalTokens"]).toBe(150);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("ai.usage");
    expect(events[0]!.payload).toMatchObject({
      modelId: "fake-mini",
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      userId: "ada",
      runId: "run-1",
      workflowId: "wf-1",
      nodeId: "node-1",
    });
  });

  it("taps the stream's finish part; anonymous callers carry no userId", async () => {
    const { ctx, events } = fakeCtx();
    const model = withUsageTap(fakeV3Model() as never, ctx) as {
      doStream: (p: unknown) => Promise<{ stream: ReadableStream }>;
    };
    const { stream } = await model.doStream({ prompt: [] });
    const reader = stream.getReader();
    const parts: unknown[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    expect(parts).toHaveLength(2); // untouched passthrough
    expect(events).toHaveLength(1);
    expect(events[0]!.payload.totalTokens).toBe(150);
    expect("userId" in events[0]!.payload).toBe(false);
  });

  it("is fail-open: a throwing bus never breaks the generation", async () => {
    const { ctx, events } = fakeCtx({ user: "ada", throwOnEmit: true });
    const model = withUsageTap(fakeV3Model() as never, ctx) as { doGenerate: (p: unknown) => Promise<{ finishReason: string }> };
    const result = await model.doGenerate({ prompt: [] });
    expect(result.finishReason).toBe("stop");
    expect(events).toHaveLength(0);
  });

  it("passes non-v3 models through untouched", () => {
    const { ctx } = fakeCtx();
    const legacy = { specificationVersion: "v2", modelId: "old" };
    expect(withUsageTap(legacy as never, ctx)).toBe(legacy);
  });
});
