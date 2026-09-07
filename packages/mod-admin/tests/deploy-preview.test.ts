/**
 * The deploy preview answers the operator's questions from two documents:
 * which routes appear/disappear, whose auth gate changed, which external
 * nodes join, and whether durable/offload flipped — with ui-only edits
 * counting as "nothing changes".
 */
import { describe, it, expect } from "vitest";
import type { OpInfo, WorkflowDoc } from "@pattern-js/admin-sdk";
import { authLabel, deployPreview, isExternalNode } from "../src/app/lib/deploy-preview";

const op = (type: string, effects?: OpInfo["effects"]): OpInfo => ({
  type,
  category: type.split(".")[1] ?? type,
  inputs: [],
  outputs: [],
  configInputs: [],
  controlOut: [],
  usedBy: 0,
  reusable: true,
  ...(effects ? { effects } : {}),
});
const ops = new Map<string, OpInfo>([
  ["boundary.http.request", op("boundary.http.request")],
  ["boundary.http.response", op("boundary.http.response")],
  ["core.math.add", op("core.math.add", "pure")],
  ["email.send", op("email.send", "external")],
  ["billing.checkout.create", op("billing.checkout.create", "dynamic")],
  ["acme.mystery", op("acme.mystery")],
]);

const live: WorkflowDoc = {
  id: "wf",
  nodes: [
    { id: "in", op: "boundary.http.request", config: { method: "GET", path: "/hello", requireAuth: { scopes: ["member"] } } },
    { id: "add", op: "core.math.add", config: { a: 1 }, ui: { x: 0, y: 0 } },
    { id: "out", op: "boundary.http.response", config: {} },
  ],
  edges: [{ from: { node: "in", port: "out" }, to: { node: "add", port: "a" } }],
};

describe("deployPreview", () => {
  it("first deploy: everything is new", () => {
    const p = deployPreview(null, live, ops);
    expect(p.first).toBe(true);
    expect(p.routes.added).toEqual(["GET /hello"]);
    expect(p.auth).toEqual([{ node: "in", before: "—", after: "scopes: member" }]);
    expect(p.external.added).toEqual([]);
    expect(p.equal).toBe(false);
  });

  it("ui-only edits (positions) change nothing the engine reads", () => {
    const moved: WorkflowDoc = { ...live, nodes: live.nodes.map((n) => (n.id === "add" ? { ...n, ui: { x: 400, y: 80 }, title: "Sum" } : n)) };
    const p = deployPreview(live, moved, ops);
    expect(p.equal).toBe(true);
    expect(p.nodes).toEqual({ added: 0, removed: 0, changed: 0 });
  });

  it("names route, auth, side-effect, and flag changes", () => {
    const next: WorkflowDoc = {
      ...live,
      durable: true,
      nodes: [
        { id: "in", op: "boundary.http.request", config: { method: "POST", path: "/hello" } }, // auth dropped → public
        { id: "add", op: "core.math.add", config: { a: 2 } }, // config change
        { id: "mail", op: "email.send", config: {} }, // declared external
        { id: "pay", op: "billing.checkout.create", config: {} }, // dynamic → treated external
        { id: "x", op: "acme.mystery", config: {} }, // undeclared → external
        { id: "out", op: "boundary.http.response", config: {} },
      ],
      edges: [],
    };
    const p = deployPreview(live, next, ops);
    expect(p.first).toBe(false);
    expect(p.routes).toEqual({ added: ["POST /hello"], removed: ["GET /hello"] });
    expect(p.auth).toEqual([{ node: "in", before: "scopes: member", after: "none" }]);
    expect(p.external.added.map((n) => n.node)).toEqual(["mail", "pay", "x"]);
    expect(p.flags).toEqual([{ flag: "durable", before: false, after: true }]);
    expect(p.nodes).toEqual({ added: 3, removed: 0, changed: 2 }); // in + add changed
    expect(p.edges).toEqual({ added: 0, removed: 1 });
    expect(p.equal).toBe(false);
  });

  it("a removed gated trigger is reported (its gate leaves with it)", () => {
    const next: WorkflowDoc = { ...live, nodes: live.nodes.filter((n) => n.id !== "in"), edges: [] };
    const p = deployPreview(live, next, ops);
    expect(p.routes.removed).toEqual(["GET /hello"]);
    expect(p.auth[0]).toMatchObject({ node: "in", after: "— (node removed)" });
  });

  it("isExternalNode follows the engine: undeclared = external, boundaries never", () => {
    expect(isExternalNode({ id: "a", op: "acme.mystery" }, ops)).toBe(true);
    expect(isExternalNode({ id: "b", op: "core.math.add" }, ops)).toBe(false);
    expect(isExternalNode({ id: "c", op: "boundary.http.response" }, ops)).toBe(false);
    expect(isExternalNode({ id: "d", op: "not.installed" }, ops)).toBe(false);
  });

  it("authLabel reads every requireAuth shape", () => {
    expect(authLabel(undefined)).toBe("none");
    expect(authLabel(true)).toBe("any signed-in user");
    expect(authLabel({})).toBe("any signed-in user");
    expect(authLabel({ scopes: ["admin"], roles: ["owner"] })).toBe("scopes: admin · roles: owner");
  });
});
