/**
 * core — the httpEndpoint route builder.
 *
 * One shape, mechanically emitted: trigger → extract(per request part) → op →
 * (status | build | stream) → response. These assert the graph structure (the
 * 35 admin routes + every mod's routes ride on it), plus the auth stamp.
 */

import { describe, it, expect } from "vitest";
import { httpEndpoint, fromParams, fromQuery, fromBody, type Workflow } from "../src/index.js";

const nodeOps = (wf: Workflow) => wf.nodes.map((n) => n.op);
const node = (wf: Workflow, id: string) => wf.nodes.find((n) => n.id === id);
const edge = (wf: Workflow, from: string, fromPort: string, to: string, toPort: string) =>
  wf.edges.some((e) => e.from.node === from && e.from.port === fromPort && e.to.node === to && e.to.port === toPort);

describe("httpEndpoint", () => {
  it("decomposes each request part onto the op's ports and status-maps a single output", () => {
    const wf = httpEndpoint({
      id: "store.route.admin.docs",
      method: "GET",
      path: "/admin/api/store/collections/:collection/docs",
      op: "store.admin.docs",
      io: { in: { collection: fromParams(), limit: fromQuery() }, out: "documents" },
    });

    // One extract per non-empty request part, wired request → extract → op port.
    expect(nodeOps(wf)).toContain("core.object.extract");
    expect((node(wf, "ex_params")!.config as { keys: string[] }).keys).toEqual(["collection"]);
    expect((node(wf, "ex_query")!.config as { keys: string[] }).keys).toEqual(["limit"]);
    expect(edge(wf, "in", "params", "ex_params", "object")).toBe(true);
    expect(edge(wf, "ex_params", "collection", "call", "collection")).toBe(true);
    expect(edge(wf, "ex_query", "limit", "call", "limit")).toBe(true);

    // The trigger declares an input schema for each part it reads.
    const cfg = node(wf, "in")!.config as Record<string, { type: string }>;
    expect(cfg.params).toMatchObject({ type: "object" });
    expect(cfg.query).toMatchObject({ type: "object" });

    // Single output goes through boundary.http.status (domain outcome → 4xx).
    expect(nodeOps(wf)).toContain("boundary.http.status");
    expect(edge(wf, "call", "documents", "status", "result")).toBe(true);
    expect(edge(wf, "status", "status", "out", "status")).toBe(true);
    expect(edge(wf, "status", "body", "out", "body")).toBe(true);
  });

  it("pulses a no-input op straight from the trigger (no extract)", () => {
    const wf = httpEndpoint({
      id: "store.route.admin.collections",
      method: "GET",
      path: "/admin/api/store/collections",
      op: "store.admin.collections",
      io: { out: "collections" },
    });
    expect(nodeOps(wf)).not.toContain("core.object.extract");
    expect(edge(wf, "in", "out", "call", "in")).toBe(true);
  });

  it("reassembles several named outputs with core.object.build (no status mapper)", () => {
    const wf = httpEndpoint({
      id: "r.save",
      method: "POST",
      path: "/admin/api/x/save",
      op: "x.save",
      io: { in: { doc: fromBody() }, out: ["version", "issues"] },
    });
    expect(nodeOps(wf)).toContain("core.object.build");
    expect(nodeOps(wf)).not.toContain("boundary.http.status");
    expect((node(wf, "body")!.config as { keys: string[] }).keys).toEqual(["version", "issues"]);
    expect(edge(wf, "call", "version", "body", "version")).toBe(true);
    expect(edge(wf, "body", "out", "out", "body")).toBe(true);
  });

  it("streams an sse output straight to the response", () => {
    const wf = httpEndpoint({
      id: "r.tail",
      method: "GET",
      path: "/admin/api/x/tail",
      op: "x.tail",
      io: { out: "events", stream: true },
    });
    expect((node(wf, "out")!.config as { mode: string }).mode).toBe("sse");
    expect(edge(wf, "call", "events", "out", "stream")).toBe(true);
    expect(nodeOps(wf)).not.toContain("boundary.http.status");
  });

  it("stamps requireAuth onto the boundary nodes only", () => {
    const wf = httpEndpoint({
      id: "r.guarded",
      method: "GET",
      path: "/admin/api/x/guarded",
      op: "x.read",
      io: { out: "value" },
      auth: { scopes: ["admin"] },
    });
    expect((node(wf, "in")!.config as { requireAuth?: unknown }).requireAuth).toEqual({ scopes: ["admin"] });
    expect((node(wf, "out")!.config as { requireAuth?: unknown }).requireAuth).toEqual({ scopes: ["admin"] });
    expect((node(wf, "call")!.config as { requireAuth?: unknown } | undefined)?.requireAuth).toBeUndefined();
  });
});
