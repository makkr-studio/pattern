/**
 * Scoped API tokens (0.4.0): the multi-use revocable bearer kernel + the
 * `Authorization: Bearer pat_…` AuthProvider, exercised end-to-end over HTTP
 * against routes gated by granular scopes (port 5071).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { Engine, IDENTITY_SERVICE, type Workflow } from "@pattern-js/core";
import { createHttpHost } from "@pattern-js/runtime-node";
import { identityMod } from "../src/mod.js";
import { memoryIdentityStores } from "../src/store/memory.js";
import { DefaultIdentityService, type IdentityService } from "../src/service.js";
import { resolveOptions } from "../src/options.js";

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
  vi.restoreAllMocks();
});

/** A service over memory stores, no HTTP — for the kernel-only tests. */
function bareService(): IdentityService {
  return new DefaultIdentityService(memoryIdentityStores(), resolveOptions({ storage: "memory" }));
}

const route = (id: string, path: string, scopes: string[]): Workflow => ({
  id,
  nodes: [
    { id: "in", op: "boundary.http.request", config: { method: "GET", path, requireAuth: { scopes } } },
    { id: "out", op: "boundary.http.response" },
  ],
  edges: [{ from: { node: "in", port: "user" }, to: { node: "out", port: "body" } }],
});

async function boot(port: number) {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const engine = new Engine();
  await engine.useAsync(identityMod({ storage: "memory" }));
  engine.registerWorkflow(route("read-route", "/cp/read", ["workflows:read"]));
  engine.registerWorkflow(route("deploy-route", "/cp/deploy", ["deploy"]));
  const host = createHttpHost(engine, { defaultPort: port });
  const { close } = await host.start();
  closer = close;
  logSpy.mockRestore();
  const service = engine.service<IdentityService>(IDENTITY_SERVICE)!;
  return { engine, service, base: `http://localhost:${port}` };
}

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

describe("API token kernel", () => {
  it("mints pat_ tokens, verifies them, and never stores the secret", async () => {
    const svc = bareService();
    const minted = await svc.createApiToken({ name: "ci", scopes: ["workflows:read", "deploy"] });
    expect(minted.token).toMatch(/^pat_[A-Za-z0-9_-]{43}$/);
    expect(minted.row.expiresAt).toBeNull();

    const verified = await svc.verifyApiToken(minted.token);
    expect(verified?.id).toBe(minted.row.id);
    expect(verified?.scopes.sort()).toEqual(["deploy", "workflows:read"]);

    // The list never contains the secret in any field.
    const listed = await svc.listApiTokens();
    expect(JSON.stringify(listed)).not.toContain(minted.token);
    expect(listed[0]?.tokenHash).not.toBe(minted.token);
  });

  it("rejects unknown scopes, empty scopes and blank names at mint time", async () => {
    const svc = bareService();
    await expect(svc.createApiToken({ name: "x", scopes: ["workflows:write", "root"] })).rejects.toThrow(/root/);
    await expect(svc.createApiToken({ name: "x", scopes: [] })).rejects.toThrow(/scope/);
    await expect(svc.createApiToken({ name: "  ", scopes: ["deploy"] })).rejects.toThrow(/name/);
  });

  it("revoke is CAS-safe and idempotent; expiry is enforced", async () => {
    const svc = bareService();
    const minted = await svc.createApiToken({ name: "temp", scopes: ["runs:read"], ttlMs: 50 });
    expect(await svc.verifyApiToken(minted.token)).toBeTruthy();

    const revoked = await svc.revokeApiToken(minted.row.id);
    expect(revoked.revokedAt).not.toBeNull();
    expect(await svc.verifyApiToken(minted.token)).toBeNull();
    // Idempotent second revoke.
    await expect(svc.revokeApiToken(minted.row.id)).resolves.toBeTruthy();

    const fresh = await svc.createApiToken({ name: "short", scopes: ["runs:read"], ttlMs: 10 });
    expect(await svc.verifyApiToken(fresh.token, Date.now() + 1_000)).toBeNull(); // past expiry
  });

  it("stamps lastUsedAt on verify (throttled, never a version bump)", async () => {
    const svc = bareService();
    const minted = await svc.createApiToken({ name: "hot", scopes: ["runs:read"] });
    await svc.verifyApiToken(minted.token);
    const [row] = await svc.listApiTokens();
    expect(row?.lastUsedAt).not.toBeNull();
    expect(row?.version).toBe(1); // a usage stamp must not invalidate a concurrent revoke's CAS read
  });
});

describe("bearer auth over HTTP (port 5071)", () => {
  it("grants/denies by scope: author vs deploy vs admin vs garbage", async () => {
    const { service, base } = await boot(5071);
    const author = await service.createApiToken({ name: "author", scopes: ["workflows:read", "workflows:write"] });
    const deployer = await service.createApiToken({ name: "deployer", scopes: ["deploy"] });
    const root = await service.createApiToken({ name: "root", scopes: ["admin"] });

    // author token: read yes, deploy no.
    expect((await fetch(`${base}/cp/read`, bearer(author.token))).status).toBe(200);
    expect((await fetch(`${base}/cp/deploy`, bearer(author.token))).status).toBe(401);
    // deploy token: the reverse.
    expect((await fetch(`${base}/cp/read`, bearer(deployer.token))).status).toBe(401);
    expect((await fetch(`${base}/cp/deploy`, bearer(deployer.token))).status).toBe(200);
    // admin = root scope: satisfies both.
    expect((await fetch(`${base}/cp/read`, bearer(root.token))).status).toBe(200);
    expect((await fetch(`${base}/cp/deploy`, bearer(root.token))).status).toBe(200);
    // no header / malformed / unknown token → 401 (never authenticated).
    expect((await fetch(`${base}/cp/read`)).status).toBe(401);
    expect((await fetch(`${base}/cp/read`, bearer("pat_nope"))).status).toBe(401);
    expect((await fetch(`${base}/cp/read`, { headers: { authorization: "Basic abc" } })).status).toBe(401);
  });

  it("revocation cuts access immediately; principal carries token identity", async () => {
    const { service, base } = await boot(5072);
    const t = await service.createApiToken({ name: "shortlived", scopes: ["workflows:read"] });

    const ok = await fetch(`${base}/cp/read`, bearer(t.token));
    expect(ok.status).toBe(200);
    // The route echoes the `user` port: the flattened principal.
    const body = (await ok.json()) as { id: string; claims?: { tokenName?: string } };
    expect(body.id).toBe(`apitoken:${t.row.id}`);
    expect(body.claims?.tokenName).toBe("shortlived");

    await service.revokeApiToken(t.row.id);
    expect((await fetch(`${base}/cp/read`, bearer(t.token))).status).toBe(401);
  });
});
