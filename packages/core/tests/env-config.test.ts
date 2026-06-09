import { describe, it, expect } from "vitest";
import { Engine, interpolateValue, resolveWorkflowEnv, EnvConfigError, type Workflow } from "@pattern/core";

describe("env interpolation — object form", () => {
  const env = { PORT: "8080", FLAG: "true", RATIO: "1.5", LIST: '["a","b"]' };

  it("casts by type", () => {
    expect(interpolateValue({ $env: "PORT", type: "number" }, env)).toBe(8080);
    expect(interpolateValue({ $env: "PORT", type: "integer" }, env)).toBe(8080);
    expect(interpolateValue({ $env: "FLAG", type: "boolean" }, env)).toBe(true);
    expect(interpolateValue({ $env: "RATIO", type: "number" }, env)).toBe(1.5);
    expect(interpolateValue({ $env: "LIST", type: "json" }, env)).toEqual(["a", "b"]);
    expect(interpolateValue({ $env: "PORT" }, env)).toBe("8080"); // default type string
  });

  it("uses the default when unset/empty", () => {
    expect(interpolateValue({ $env: "MISSING", type: "number", default: 3001 }, env)).toBe(3001);
    expect(interpolateValue({ $env: "EMPTY", default: "x" }, { EMPTY: "" })).toBe("x");
  });

  it("throws when required and unset without default", () => {
    expect(() => interpolateValue({ $env: "MISSING" }, env)).toThrow(EnvConfigError);
  });

  it("throws on bad casts", () => {
    expect(() => interpolateValue({ $env: "PORT", type: "boolean" }, env)).toThrow(/boolean/);
    expect(() => interpolateValue({ $env: "FLAG", type: "number" }, env)).toThrow(/number/);
  });
});

describe("env interpolation — string form", () => {
  const env = { HOST: "db.local", REDIS_HOST: "cache" };

  it("interpolates ${VAR} and ${VAR:-fallback}", () => {
    expect(interpolateValue("redis://${REDIS_HOST}:${REDIS_PORT:-6379}", env)).toBe("redis://cache:6379");
    expect(interpolateValue("host=${HOST}", env)).toBe("host=db.local");
  });

  it("throws on a missing var without a fallback", () => {
    expect(() => interpolateValue("x=${NOPE}", env)).toThrow(EnvConfigError);
  });

  it("escapes $${...} to a literal ${...}", () => {
    expect(interpolateValue("price is $${amount}", env)).toBe("price is ${amount}");
  });

  it("recurses into nested objects and arrays", () => {
    const out = interpolateValue({ a: ["${HOST}", { b: { $env: "REDIS_HOST" } }] }, env);
    expect(out).toEqual({ a: ["db.local", { b: "cache" }] });
  });
});

describe("env interpolation — engine integration", () => {
  it("resolves a typed port ref so the op config validates", async () => {
    const wf: Workflow = {
      id: "envwf",
      nodes: [
        { id: "in", op: "boundary.http.request", config: { path: "/x", port: { $env: "ADMIN_PORT", type: "number", default: 3001 } } as any },
        { id: "out", op: "boundary.http.response" },
      ],
      edges: [{ from: { node: "in", port: "out" }, to: { node: "out", port: "in" } }],
    };
    // No env → default 3001; the stored workflow has a concrete number.
    const engine = new Engine();
    engine.registerWorkflow(wf);
    expect((engine.workflows.get("envwf")!.nodes[0]!.config as any).port).toBe(3001);

    // With env → overridden + cast to a number.
    const engine2 = new Engine({ env: { ADMIN_PORT: "9000" } });
    engine2.registerWorkflow(wf);
    expect((engine2.workflows.get("envwf")!.nodes[0]!.config as any).port).toBe(9000);
  });

  it("resolveWorkflowEnv leaves env-free workflows equivalent", () => {
    const wf: Workflow = {
      id: "plain",
      nodes: [{ id: "k", op: "core.const.number", config: { value: 5 } }],
      edges: [],
    };
    expect(resolveWorkflowEnv(wf, {})).toEqual(wf);
  });
});
