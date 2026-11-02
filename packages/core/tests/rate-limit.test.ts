import { describe, it, expect } from "vitest";
import { Engine, RateLimiter, parseDurationMs, type Workflow } from "@pattern-js/core";

describe("RateLimiter (sliding window)", () => {
  it("allows max hits per window, refuses the next, and does not count refusals", () => {
    const l = new RateLimiter();
    const rule = { max: 3, windowMs: 1000 };
    const t0 = 10_000;
    expect([1, 2, 3].map(() => l.hit("k", rule, t0).ok)).toEqual([true, true, true]);
    const no = l.hit("k", rule, t0 + 10);
    expect(no.ok).toBe(false);
    expect(no.retryAfterMs).toBeGreaterThan(0);
    // Other keys are independent.
    expect(l.hit("other", rule, t0).ok).toBe(true);
  });

  it("blends the previous window, so a boundary can't double the burst", () => {
    const l = new RateLimiter();
    const rule = { max: 4, windowMs: 1000 };
    for (let i = 0; i < 4; i++) l.hit("k", rule, 1999); // end of window [1000, 2000)
    // Just after the boundary the previous window still weighs ~100%.
    expect(l.hit("k", rule, 2001).ok).toBe(false);
    // Halfway through, half of it has decayed: 4·0.5 = 2 → room for 1 more (2+1 ≤ 4... and the next).
    expect(l.hit("k", rule, 2500).ok).toBe(true);
    // Two windows later everything has decayed.
    expect(l.hit("k", rule, 4000).ok).toBe(true);
  });

  it("the advertised retryAfter is when a hit succeeds again", () => {
    const l = new RateLimiter();
    const rule = { max: 2, windowMs: 1000 };
    const t0 = 5_000;
    l.hit("k", rule, t0);
    l.hit("k", rule, t0);
    const no = l.hit("k", rule, t0 + 100);
    expect(no.ok).toBe(false);
    const at = t0 + 100 + no.retryAfterMs;
    expect(l.hit("k", rule, at - 2).ok).toBe(false);
    expect(l.hit("k", rule, at).ok).toBe(true);
  });

  it("bounds memory", () => {
    const l = new RateLimiter({ maxKeys: 100 });
    for (let i = 0; i < 1000; i++) l.hit(`k${i}`, { max: 1, windowMs: 60_000 }, 1);
    expect(l.size).toBeLessThanOrEqual(100);
  });

  it("parses durations", () => {
    expect(parseDurationMs(250)).toBe(250);
    expect(parseDurationMs("30s")).toBe(30_000);
    expect(parseDurationMs("15m")).toBe(900_000);
    expect(parseDurationMs("1h")).toBe(3_600_000);
    expect(() => parseDurationMs("soon")).toThrow(/invalid duration/);
  });
});

describe("core.flow.throttle", () => {
  it("pulses `out` up to max per key, then `limited`", async () => {
    const engine = new Engine();
    const wf: Workflow = {
      id: "th",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["key"] } },
        { id: "th", op: "core.flow.throttle", config: { max: 2, window: "1h" } },
        { id: "yes", op: "core.const.string", config: { value: "sent" } },
        { id: "no", op: "core.const.string", config: { value: "held" } },
        { id: "ok", op: "boundary.return", config: { name: "ok" } },
        { id: "lim", op: "boundary.return", config: { name: "lim" } },
      ],
      edges: [
        { from: { node: "in", port: "key" }, to: { node: "th", port: "key" } },
        { from: { node: "th", port: "out" }, to: { node: "yes", port: "in" } },
        { from: { node: "th", port: "limited" }, to: { node: "no", port: "in" } },
        { from: { node: "yes", port: "out" }, to: { node: "ok", port: "value" } },
        { from: { node: "no", port: "out" }, to: { node: "lim", port: "value" } },
      ],
    } as Workflow;
    engine.registerWorkflow(wf);
    const run = async (key: string) => {
      const r = await engine.run("th", { input: { key } });
      expect(r.status).toBe("ok");
      return JSON.stringify(r.outputs);
    };
    expect(await run("ada@x.io")).toContain("sent");
    expect(await run("ada@x.io")).toContain("sent");
    expect(await run("ada@x.io")).toContain("held");
    expect(await run("bob@x.io")).toContain("sent");
  });
});
