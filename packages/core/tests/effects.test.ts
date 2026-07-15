import { describe, it, expect } from "vitest";
import { Engine, effectsOf, type OpDefinition } from "@pattern-js/core";

describe("op effects (replay-safety signal)", () => {
  it("absent means external — the safe default for unstamped ops", () => {
    const op: OpDefinition = { type: "t.x", inputs: {}, outputs: {}, execute: () => ({}) };
    expect(effectsOf(op, {})).toBe("external");
  });

  it("resolves the config-function form", () => {
    const op: OpDefinition = {
      type: "t.fetchish",
      inputs: {},
      outputs: {},
      effects: (config: any) => (config?.method === "GET" ? "idempotent" : "external"),
      execute: () => ({}),
    };
    expect(effectsOf(op, { method: "GET" })).toBe("idempotent");
    expect(effectsOf(op, { method: "POST" })).toBe("external");
  });

  it("the base catalog carries honest stamps", () => {
    const engine = new Engine();
    const ops = engine.ops;
    // pureOp-built value transforms are pure by construction.
    expect(effectsOf(ops.get("core.string.concat")!, {})).toBe("pure");
    // Hand-stamped control flow is pure; sub-run wrappers stay external
    // (the child's effects are unknowable here).
    expect(effectsOf(ops.get("core.flow.branch")!, {})).toBe("pure");
    expect(effectsOf(ops.get("core.flow.try")!, {})).toBe("external");
    // Network out is external; the bus fan-out too.
    expect(effectsOf(ops.get("core.http.fetch")!, {})).toBe("external");
    expect(effectsOf(ops.get("core.event.emit")!, {})).toBe("external");
    // Repeat-converging telemetry.
    expect(effectsOf(ops.get("core.log")!, {})).toBe("idempotent");
  });
});
