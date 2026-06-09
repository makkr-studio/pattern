import { describe, it, expect } from "vitest";
import { Engine, type Workflow } from "@pattern/core";

/** HTTP route whose `port` config is fed by a `core.env` node (a config port). */
function httpWithEnvPort(): Workflow {
  return {
    id: "cfgport",
    nodes: [
      { id: "envp", op: "core.env", config: { name: "APP_PORT", type: "number", default: 3000 } },
      { id: "in", op: "boundary.http.request", config: { method: "GET", path: "/x" } },
      { id: "body", op: "core.const.string", config: { value: "hi" } },
      { id: "out", op: "boundary.http.response" },
    ],
    edges: [
      { from: { node: "envp", port: "out" }, to: { node: "in", port: "port" } }, // config port
      { from: { node: "in", port: "out" }, to: { node: "out", port: "in" } },
      { from: { node: "body", port: "out" }, to: { node: "out", port: "body" } },
    ],
  };
}

describe("boundary config ports — resolve phase (§7)", () => {
  it("resolves a config port from core.env at registration, freezing the value", async () => {
    const engine = new Engine({ env: { APP_PORT: "8123" } });
    await engine.registerWorkflowAsync(httpWithEnvPort());
    const stored = engine.workflows.get("cfgport")!;
    const inNode = stored.nodes.find((n) => n.id === "in")!;
    expect((inNode.config as any).port).toBe(8123); // a number, frozen into config
    // The config edge is gone; the runtime graph has no edge into the trigger.
    expect(stored.edges.some((e) => e.to.node === "in" && e.to.port === "port")).toBe(false);
  });

  it("uses the core.env default when the var is unset", async () => {
    const engine = new Engine(); // empty env
    await engine.registerWorkflowAsync(httpWithEnvPort());
    expect((engine.workflows.get("cfgport")!.nodes.find((n) => n.id === "in")!.config as any).port).toBe(3000);
  });

  it("composes config from multiple ops (env → template → path)", async () => {
    const engine = new Engine({ env: { TENANT: "acme" } });
    const wf: Workflow = {
      id: "computed-path",
      nodes: [
        { id: "tenant", op: "core.env", config: { name: "TENANT", default: "public" } },
        { id: "pathv", op: "core.string.template", config: { template: "/api/{{ tenant }}/info" } },
        { id: "wrap", op: "core.object.build", config: { keys: ["tenant"] } },
        { id: "in", op: "boundary.http.request", config: { method: "GET" } },
        { id: "k", op: "core.const.string", config: { value: "ok" } },
        { id: "out", op: "boundary.http.response" },
      ],
      edges: [
        { from: { node: "tenant", port: "out" }, to: { node: "wrap", port: "tenant" } },
        { from: { node: "wrap", port: "out" }, to: { node: "pathv", port: "data" } },
        { from: { node: "pathv", port: "out" }, to: { node: "in", port: "path" } }, // config port
        { from: { node: "in", port: "out" }, to: { node: "out", port: "in" } },
        { from: { node: "k", port: "out" }, to: { node: "out", port: "body" } },
      ],
    };
    await engine.registerWorkflowAsync(wf);
    expect((engine.workflows.get("computed-path")!.nodes.find((n) => n.id === "in")!.config as any).path).toBe("/api/acme/info");
  });

  it("sync registerWorkflow rejects config-port workflows with a clear error", () => {
    const engine = new Engine();
    expect(() => engine.registerWorkflow(httpWithEnvPort())).toThrow(/config ports/);
  });

  it("rejects config that depends on runtime data", async () => {
    const engine = new Engine();
    const wf: Workflow = {
      id: "bad",
      nodes: [
        { id: "in", op: "boundary.http.request", config: { method: "GET", path: "/y" } },
        { id: "m", op: "core.object.get", config: { path: "p" } },
        { id: "out", op: "boundary.http.response" },
      ],
      edges: [
        { from: { node: "in", port: "query" }, to: { node: "m", port: "object" } }, // m reads runtime data
        { from: { node: "m", port: "out" }, to: { node: "in", port: "port" } }, // …and feeds a config port
        { from: { node: "in", port: "out" }, to: { node: "out", port: "in" } },
      ],
    };
    await expect(engine.registerWorkflowAsync(wf)).rejects.toThrow(/runtime/);
  });
});
