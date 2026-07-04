import { describe, it, expect } from "vitest";
import { Engine, type AuthProvider, type Principal } from "@pattern-js/core";

const headerProvider: AuthProvider = {
  name: "header",
  async authenticate({ headers }) {
    const user = headers.get("x-user");
    if (!user) return null;
    return { kind: "user", id: user, provider: "header", scopes: headers.get("x-scopes")?.split(",") ?? [] };
  },
};

/** An engine where auth is *enforceable* — a provider is registered, so
 *  `authorize` actually checks requirements instead of degrading to open. */
function enforcing(env?: Record<string, string>): Engine {
  const engine = new Engine(env ? { env } : undefined);
  engine.registerAuthProvider(headerProvider);
  return engine;
}

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

  it("enforces requireAuth against anonymous (with a provider installed)", () => {
    const engine = enforcing();
    expect(engine.authorize({ kind: "anonymous" }, true).ok).toBe(false);
    expect(engine.authorize({ kind: "anonymous" }, undefined).ok).toBe(true);
  });

  it("degrades a declared requireAuth to advisory-open with NO provider", () => {
    // Nobody can authenticate without a provider, so enforcing would brick the
    // route — a declared requirement serves open instead (the host warns at boot).
    const open = new Engine();
    expect(open.authorize({ kind: "anonymous" }, true).ok).toBe(true);
    expect(open.authorize({ kind: "anonymous" }, { scopes: ["admin"] }).ok).toBe(true);
    // Add a provider → the same requirement is enforced.
    expect(enforcing().authorize({ kind: "anonymous" }, { scopes: ["admin"] }).ok).toBe(false);
  });

  it("enforces required scopes", () => {
    const engine = enforcing();
    const user: Principal = { kind: "user", id: "u", provider: "p", scopes: ["read"] };
    expect(engine.authorize(user, { scopes: ["read"] }).ok).toBe(true);
    const denied = engine.authorize(user, { scopes: ["admin"] });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toMatch(/admin/);
  });

  it("treats the admin scope as root — it satisfies any requirement", () => {
    const engine = enforcing();
    const admin: Principal = { kind: "user", id: "root", provider: "p", scopes: ["admin"] };
    // Granular API-token scopes an admin session never carries explicitly.
    expect(engine.authorize(admin, { scopes: ["workflows:read"] }).ok).toBe(true);
    expect(engine.authorize(admin, { scopes: ["workflows:write", "deploy"] }).ok).toBe(true);
    expect(engine.authorize(admin, true).ok).toBe(true);
    // The reverse never holds: a granular token does not satisfy admin.
    const scoped: Principal = { kind: "user", id: "t", provider: "p", scopes: ["workflows:read", "deploy"] };
    expect(engine.authorize(scoped, { scopes: ["admin"] }).ok).toBe(false);
    // And anonymous stays rejected regardless.
    expect(engine.authorize({ kind: "anonymous" }, { scopes: ["workflows:read"] }).ok).toBe(false);
  });

  it("resolves an { env } requirement against the engine env per call", () => {
    const anon: Principal = { kind: "anonymous" };
    const user: Principal = { kind: "user", id: "u", provider: "p", scopes: ["user"] };

    // Unset / falsey → open (the default-guests-allowed posture).
    for (const env of [{}, { GATE: "" }, { GATE: "false" }, { GATE: "0" }, { GATE: "no" }, { GATE: "off" }]) {
      expect(enforcing(env).authorize(anon, { env: "GATE" }).ok).toBe(true);
    }
    // Truthy → any authenticated user.
    for (const v of ["true", "1", "yes", "on", "TRUE"]) {
      const engine = enforcing({ GATE: v });
      expect(engine.authorize(anon, { env: "GATE" }).ok).toBe(false);
      expect(engine.authorize(user, { env: "GATE" }).ok).toBe(true);
    }
    // Anything else → comma-separated scope list.
    const scoped = enforcing({ GATE: "user, admin" });
    expect(scoped.authorize(anon, { env: "GATE" }).ok).toBe(false);
    expect(scoped.authorize(user, { env: "GATE" }).ok).toBe(false); // missing "admin"
    const both: Principal = { kind: "user", id: "u", provider: "p", scopes: ["user", "admin"] };
    expect(scoped.authorize(both, { env: "GATE" }).ok).toBe(true);
  });

  it("validates the { env } requireAuth form in trigger config", () => {
    const engine = new Engine();
    const wf = {
      id: "gated",
      nodes: [
        { id: "t", op: "boundary.manual", config: { requireAuth: { env: "GATE" } } },
        { id: "out", op: "boundary.return" },
      ],
      edges: [{ from: { node: "t", port: "value" }, to: { node: "out", port: "value" } }],
    };
    expect(() => engine.validate(wf)).not.toThrow();
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
