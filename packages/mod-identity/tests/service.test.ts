import { describe, it, expect } from "vitest";
import { DefaultIdentityService } from "../src/service.js";
import { memoryIdentityStores } from "../src/store/memory.js";
import { resolveOptions } from "../src/options.js";

function makeService(over: Parameters<typeof resolveOptions>[0] = {}) {
  return new DefaultIdentityService(
    memoryIdentityStores(),
    resolveOptions({ touchThrottleMs: 0, ...over }),
  );
}

const identity = (email: string, allowCreate = true, roles?: string[]) => ({
  provider: "magic-link",
  subject: email.toLowerCase(),
  email,
  allowCreate,
  roles,
});

describe("DefaultIdentityService", () => {
  it("find-or-create honors allowCreate (the signup policy lever)", async () => {
    const svc = makeService();
    // Closed door: unknown identity, no create permission → null.
    expect(await svc.findOrCreateByIdentity(identity("ada@x.io", false))).toBeNull();
    // Open door: created with the given roles.
    const created = await svc.findOrCreateByIdentity(identity("ada@x.io", true, ["admin"]));
    expect(created?.roles).toEqual(["admin"]);
    // Second login: found by identity, no create needed.
    const again = await svc.findOrCreateByIdentity(identity("ada@x.io", false));
    expect(again?.id).toBe(created!.id);
  });

  it("links a new provider to an existing user by email instead of duplicating", async () => {
    const svc = makeService();
    const viaMagic = await svc.findOrCreateByIdentity(identity("ada@x.io"));
    const viaOidc = await svc.findOrCreateByIdentity({
      provider: "oidc",
      subject: "google|123",
      email: "Ada@X.io", // different case — emailNorm matches
      allowCreate: false,
    });
    expect(viaOidc?.id).toBe(viaMagic!.id);
  });

  it("mints a session and resolves it by raw token with compiled scopes", async () => {
    const svc = makeService({ roles: { admin: ["admin", "ops"], viewer: ["read"] } });
    const user = await svc.findOrCreateByIdentity(identity("ada@x.io", true, ["admin", "viewer"]));
    const minted = await svc.mintSession(user!.id, { userAgent: "vitest" });

    const resolved = await svc.resolveSessionByToken(minted.token);
    expect(resolved?.user.id).toBe(user!.id);
    expect(resolved?.scopes.sort()).toEqual(["admin", "ops", "read"]);
    expect(resolved?.session.userAgent).toBe("vitest");
    // Garbage token resolves to nothing.
    expect(await svc.resolveSessionByToken("nope")).toBeNull();
  });

  it("slides expiry on resolve (and an expired session is dead)", async () => {
    const svc = makeService({ sessionTtlMs: 1000 });
    const user = await svc.findOrCreateByIdentity(identity("ada@x.io"));
    const minted = await svc.mintSession(user!.id);

    const later = Date.now() + 600;
    const r1 = await svc.resolveSessionByToken(minted.token, later);
    expect(r1).not.toBeNull();
    // The touch extended expiry past the original deadline.
    const r2 = await svc.resolveSessionByToken(minted.token, Date.now() + 1200);
    expect(r2).not.toBeNull();
    // Way past any sliding window → dead.
    expect(await svc.resolveSessionByToken(minted.token, Date.now() + 60_000)).toBeNull();
  });

  it("revocation, role changes and disabling all end sessions", async () => {
    const svc = makeService();
    const user = await svc.findOrCreateByIdentity(identity("ada@x.io"));

    const a = await svc.mintSession(user!.id);
    await svc.revokeSession(a.sessionId);
    expect(await svc.resolveSessionByToken(a.token)).toBeNull();

    const b = await svc.mintSession(user!.id);
    await svc.setRoles(user!.id, ["admin"]); // privilege change revokes
    expect(await svc.resolveSessionByToken(b.token)).toBeNull();
    expect((await svc.getUser(user!.id))?.roles).toEqual(["admin"]);

    // A second admin, so the last-admin floor lets us disable the first.
    await svc.findOrCreateByIdentity(identity("grace@x.io", true, ["admin"]));

    const c = await svc.mintSession(user!.id);
    await svc.setDisabled(user!.id, true);
    expect(await svc.resolveSessionByToken(c.token)).toBeNull();
    // Re-enable: old sessions stay revoked, new ones work.
    await svc.setDisabled(user!.id, false);
    expect(await svc.resolveSessionByToken(c.token)).toBeNull();
    const d = await svc.mintSession(user!.id);
    expect(await svc.resolveSessionByToken(d.token)).not.toBeNull();
  });

  it("issues and consumes single-use tokens (purpose-checked, expiring)", async () => {
    const svc = makeService();
    const issued = await svc.issueToken({ purpose: "login", email: "Ada@X.io", data: { next: "/admin" } });
    expect(issued.path).toContain("/auth/token?t=");
    expect(issued.path).toContain("next=%2Fadmin");

    // Wrong purpose → refused, token survives.
    expect(await svc.consumeToken(issued.token, "invite")).toBeNull();
    const consumed = await svc.consumeToken(issued.token, "login");
    expect(consumed?.emailNorm).toBe("ada@x.io");
    expect(consumed?.data).toEqual({ next: "/admin" });
    // Single-use: second consume refused.
    expect(await svc.consumeToken(issued.token, "login")).toBeNull();

    const expired = await svc.issueToken({ purpose: "login", email: "a@b.c", ttlMs: -1 });
    expect(await svc.consumeToken(expired.token)).toBeNull();
  });

  it("signup policy: option is the seed, the stored setting wins, lookups by email work", async () => {
    const svc = makeService({ signup: "invite" });
    expect(await svc.getSignup()).toBe("invite");
    await svc.setSignup("open");
    expect(await svc.getSignup()).toBe("open");
    await expect(svc.setSignup("everyone" as never)).rejects.toThrow("invalid signup mode");

    await svc.findOrCreateByIdentity(identity("Ada@X.io"));
    expect((await svc.findUserByEmail("ada@x.io"))?.email).toBe("Ada@X.io");
    expect(await svc.findUserByEmail("ghost@x.io")).toBeNull();
  });

  it("registers login methods and maps roles to deduped scopes", () => {
    const svc = makeService({ roles: { a: ["x", "y"], b: ["y", "z"] } });
    svc.registerLoginMethod({ id: "magic-link", label: "Email", kind: "form", startUrl: "/auth/magic-link/request" });
    svc.registerLoginMethod({ id: "oidc", label: "SSO", kind: "redirect", startUrl: "/auth/oidc/start" });
    expect(svc.loginMethods().map((m) => m.id)).toEqual(["magic-link", "oidc"]);
    expect(svc.scopesForRoles(["a", "b", "ghost"]).sort()).toEqual(["x", "y", "z"]);
  });
});
