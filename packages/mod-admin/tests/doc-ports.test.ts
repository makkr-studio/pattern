import { describe, it, expect } from "vitest";
import { Engine } from "@pattern-js/core";
import { docPorts } from "../src/backend/introspect.js";

/** The editor's dynamic-port source: ports resolved per node CONFIG. */
describe("admin.doc.ports (dynamic ports)", () => {
  const engine = new Engine();

  it("core.object.build grows an input port per configured key", () => {
    const ports = docPorts(engine, {
      nodes: [
        { id: "fresh", op: "core.object.build" },
        { id: "built", op: "core.object.build", config: { keys: ["user", "note"] } },
      ],
    });
    // Unconfigured: the default gives one visible port instead of zero.
    expect(ports.fresh!.inputs.map((p) => p.name)).toEqual(["value"]);
    expect(ports.built!.inputs.map((p) => p.name)).toEqual(["user", "note"]);
  });

  it("covers outputs and control-outs too (manual, sequence, stream.merge)", () => {
    const ports = docPorts(engine, {
      nodes: [
        { id: "m", op: "boundary.manual", config: { outputs: ["a", "b", "user"] } },
        { id: "seq", op: "core.flow.sequence", config: { count: 3 } },
        { id: "mrg", op: "core.stream.merge", config: { inputs: 4 } },
      ],
    });
    expect(ports.m!.outputs.map((p) => p.name)).toEqual(["a", "b", "user"]);
    expect(ports.seq!.controlOut).toEqual(["0", "1", "2"]);
    expect(ports.mrg!.inputs.map((p) => p.name)).toEqual(["in.0", "in.1", "in.2", "in.3"]);
  });

  it("falls back to defaults when a node's config breaks the resolver, skips unknown ops", () => {
    const ports = docPorts(engine, {
      nodes: [
        { id: "bad", op: "core.flow.sequence", config: { count: "not-a-number" } },
        { id: "ghost", op: "app.does.not.exist" },
      ],
    });
    expect(ports.bad).toBeDefined(); // defaults, not a throw
    expect(ports.ghost).toBeUndefined();
  });
});
