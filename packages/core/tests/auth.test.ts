import { describe, it, expect } from "vitest";
import { Engine, type AuthProvider, type Principal } from "@pattern/core";

const headerProvider: AuthProvider = {
  name: "header",
  async authenticate({ headers }) {
    const user = headers.get("x-user");
    if (!user) return null;
    return { kind: "user", id: user, provider: "header", scopes: headers.get("x-scopes")?.split(",") ?? [] };
  },
};

describe("auth (§9)", () => {
  it("defaults to anonymous", async () => {
    const engine = new Engine();
    const p = await engine.authenticate({ headers: new Headers(), raw: null });
    expect(p).toEqual({ kind: "anonymous" });
  });

  it("resolves a principal via the provider chain", async () => {
    const engine = new Engine();
    engine.registerAuthProvider(headerProvider);
    const headers = new Headers({ "x-user": "alice", "x-scopes": "read,write" });
    const p = (await engine.authenticate({ headers, raw: null })) as Extract<Principal, { kind: "user" }>;
    expect(p.kind).toBe("user");
    expect(p.id).toBe("alice");
    expect(p.scopes).toEqual(["read", "write"]);
  });

  it("enforces requireAuth against anonymous", () => {
    const engine = new Engine();
    expect(engine.authorize({ kind: "anonymous" }, true).ok).toBe(false);
    expect(engine.authorize({ kind: "anonymous" }, undefined).ok).toBe(true);
  });

  it("enforces required scopes", () => {
    const engine = new Engine();
    const user: Principal = { kind: "user", id: "u", provider: "p", scopes: ["read"] };
    expect(engine.authorize(user, { scopes: ["read"] }).ok).toBe(true);
    const denied = engine.authorize(user, { scopes: ["admin"] });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toMatch(/admin/);
  });

  it("makes the principal available to ops via ctx.principal", async () => {
    const engine = new Engine();
    engine.registerOp({
      type: "test.whoami",
      inputs: {},
      outputs: { out: { kind: "value" } },
      execute: (ctx) => ({ out: ctx.principal }),
    });
    const wf = {
      id: "who",
      nodes: [
        { id: "t", op: "boundary.manual" },
        { id: "me", op: "test.whoami" },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "me", port: "out" }, to: { node: "out", port: "value" } },
        { from: { node: "t", port: "out" }, to: { node: "out", port: "in" } },
      ],
    };
    engine.registerWorkflow(wf as any);
    const res = await engine.run(wf as any, { principal: { kind: "user", id: "bob", provider: "test" } });
    expect(Object.values(res.outputs)[0]).toEqual({ value: { kind: "user", id: "bob", provider: "test" } });
  });
});
