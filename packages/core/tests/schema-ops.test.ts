import { describe, it, expect } from "vitest";
import { Engine, TriggerInputError, type Workflow } from "@pattern-js/core";

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

  it("the ENGINE refuses runs whose seeded input fails the trigger's declared schemas", async () => {
    // No host in sight: a direct engine.run (the editor's Run panel path) must
    // fail when the body doesn't satisfy the schema the trigger declares.
    const engine = new Engine();
    const wf: Workflow = {
      id: "engine-enforces",
      nodes: [
        {
          id: "in",
          op: "boundary.http.request",
          config: {
            method: "POST",
            path: "/users/:id",
            body: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
            params: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
          },
        },
        { id: "out", op: "boundary.http.response" },
      ],
      edges: [{ from: { node: "in", port: "body" }, to: { node: "out", port: "body" } }],
    };
    engine.registerWorkflow(wf);

    const seed = (body: unknown, params: Record<string, string>) => ({
      input: { method: "POST", url: "/users/7", path: "/users/7", headers: {}, query: {}, params, body },
    });

    const bad = await engine.run("engine-enforces", seed({ name: 42 }, { id: "7" }));
    expect(bad.status).toBe("error");
    expect(bad.error).toBeInstanceOf(TriggerInputError);
    expect((bad.error as TriggerInputError).issues).toEqual([
      { port: "body", path: "name", message: expect.stringContaining("expected string") },
    ]);

    // Missing body entirely must fail too — the schema requires an object.
    const empty = await engine.run("engine-enforces", seed(undefined, { id: "7" }));
    expect(empty.status).toBe("error");
    expect(empty.error).toBeInstanceOf(TriggerInputError);

    // Params are URL strings: the params schema coerces "7" → 7.
    const ok = await engine.run("engine-enforces", seed({ name: "ada" }, { id: "7" }));
    expect(ok.status).toBe("ok");
    expect(Object.values(ok.outputs)[0]).toMatchObject({ body: { name: "ada" } });

    const badParam = await engine.run("engine-enforces", seed({ name: "ada" }, { id: "seven" }));
    expect(badParam.status).toBe("error");
    expect((badParam.error as TriggerInputError).issues[0]!.port).toBe("params");
  });
});
