import { describe, it, expect } from "vitest";
import { Engine, type Workflow } from "@pattern/core";

describe("core.schema.* — schemas as values (§12)", () => {
  it("core.schema.validate checks a value against a configured schema", async () => {
    const engine = new Engine();
    const wf: Workflow = {
      id: "validate-config",
      nodes: [
        { id: "in", op: "boundary.manual" },
        {
          id: "check",
          op: "core.schema.validate",
          config: { schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
        },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "value" }, to: { node: "check", port: "value" } },
        { from: { node: "check", port: "valid" }, to: { node: "out", port: "value" } },
      ],
    };
    engine.registerWorkflow(wf);
    const ok = await engine.run("validate-config", { input: { value: { name: "ada" } } });
    expect(Object.values(ok.outputs)[0]).toEqual({ value: true });
    const bad = await engine.run("validate-config", { input: { value: { name: 42 } } });
    expect(Object.values(bad.outputs)[0]).toEqual({ value: false });
  });

  it("core.schema.define feeds a wired validator", async () => {
    const engine = new Engine();
    const wf: Workflow = {
      id: "validate-wired",
      nodes: [
        { id: "in", op: "boundary.manual" },
        { id: "shape", op: "core.schema.define", config: { schema: { type: "number" } } },
        { id: "check", op: "core.schema.validate" },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "value" }, to: { node: "check", port: "value" } },
        { from: { node: "shape", port: "schema" }, to: { node: "check", port: "schema" } },
        { from: { node: "check", port: "valid" }, to: { node: "out", port: "value" } },
      ],
    };
    engine.registerWorkflow(wf);
    expect(Object.values((await engine.run("validate-wired", { input: { value: 7 } })).outputs)[0]).toEqual({ value: true });
    expect(Object.values((await engine.run("validate-wired", { input: { value: "x" } })).outputs)[0]).toEqual({ value: false });
  });

  it("a schema node wires into http.request's body config port (resolve phase)", async () => {
    const engine = new Engine();
    const wf: Workflow = {
      id: "schema-into-trigger",
      nodes: [
        {
          id: "shape",
          op: "core.schema.define",
          config: { schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
        },
        { id: "in", op: "boundary.http.request", config: { method: "POST", path: "/users" } },
        { id: "out", op: "boundary.http.response" },
      ],
      edges: [
        { from: { node: "shape", port: "schema" }, to: { node: "in", port: "body" } }, // config port
        { from: { node: "in", port: "body" }, to: { node: "out", port: "body" } },
      ],
    };
    await engine.registerWorkflowAsync(wf);
    const stored = engine.workflows.get("schema-into-trigger")!;
    const trigger = stored.nodes.find((n) => n.id === "in")!;
    // The schema is frozen into the trigger's config; the config edge is gone.
    expect((trigger.config as { body?: unknown }).body).toEqual({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    });
    expect(stored.edges.some((e) => e.to.node === "in" && e.to.port === "body")).toBe(false);
  });
});
