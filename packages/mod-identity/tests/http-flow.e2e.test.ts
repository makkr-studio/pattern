import { describe, it, expect, afterEach, vi } from "vitest";
import { Engine, IDENTITY_SERVICE, type Workflow } from "@pattern/core";
import { createHttpHost } from "@pattern/runtime-node";
import { identityMod } from "../src/mod.js";
import type { IdentityService } from "../src/service.js";

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
  vi.restoreAllMocks();
});

/** A protected route to prove the cookie unlocks scoped surfaces. */
const secretRoute: Workflow = {
  id: "secret",
  nodes: [
    {
      id: "in",
      op: "boundary.http.request",
      config: { method: "GET", path: "/secret", requireAuth: { scopes: ["admin"] } },
    },
    { id: "out", op: "boundary.http.response" },
  ],
  edges: [{ from: { node: "in", port: "user" }, to: { node: "out", port: "body" } }],
};

async function boot(port: number, opts: Parameters<typeof identityMod>[0] = {}) {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const engine = new Engine();
  await engine.useAsync(identityMod({ storage: "memory", ...opts }));
  engine.registerWorkflow(secretRoute);
  const host = createHttpHost(engine, { defaultPort: port });
  const { close } = await host.start();
  closer = close;
  const service = engine.service<IdentityService>(IDENTITY_SERVICE)!;
  const base = `http://localhost:${port}`;
  return { engine, service, base, logSpy };
}

const cookieOf = (res: Response): string => {
  const setCookie = res.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0] ?? "";
};

/** Run the bootstrap flow (console link → form post) and return the session cookie. */
async function bootstrapAdmin(base: string, logSpy: ReturnType<typeof vi.spyOn>, email = "ada@x.io") {
  const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
  const token = /bootstrap\?t=([A-Za-z0-9_-]+)/.exec(printed)?.[1];
  expect(token, "bootstrap link printed to console").toBeTruthy();

  const page = await fetch(`${base}/auth/bootstrap?t=${token}`);
  expect(page.status).toBe(200);
  expect(await page.text()).toContain("Create the first account");

  const submit = await fetch(`${base}/auth/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ t: token!, email, name: "Ada" }).toString(),
    redirect: "manual",
  });
  expect(submit.status).toBe(302);
  const cookie = cookieOf(submit);
  expect(cookie).toMatch(/^pattern_session=/);
  return cookie;
}

describe("identity over HTTP (e2e)", () => {
  it("bootstrap → whoami → protected route → logout", async () => {
    const { base, logSpy } = await boot(4861);
    const cookie = await bootstrapAdmin(base, logSpy);

    // whoami sees the new admin
    const who = await fetch(`${base}/auth/whoami`, { headers: { cookie } });
    const me = await who.json();
    expect(me).toMatchObject({ kind: "user", email: "ada@x.io", name: "Ada", roles: ["admin"] });
    expect(me.scopes).toContain("admin");

    // the cookie unlocks the scoped route (and the user port is seeded)
    expect((await fetch(`${base}/secret`)).status).toBe(401);
    const secret = await fetch(`${base}/secret`, { headers: { cookie } });
    expect(secret.status).toBe(200);
    expect(await secret.json()).toMatchObject({ email: "ada@x.io", scopes: ["admin"] });

    // logout revokes + clears; whoami drops to anonymous
    const out = await fetch(`${base}/auth/logout`, { method: "POST", headers: { cookie }, redirect: "manual" });
    expect(out.status).toBe(302);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    const after = await fetch(`${base}/auth/whoami`, { headers: { cookie } });
    expect(await after.json()).toEqual({ kind: "anonymous" });
    expect((await fetch(`${base}/secret`, { headers: { cookie } })).status).toBe(401);
  });

  it("second boot with users does NOT re-bootstrap; login page renders", async () => {
    const { base, service, logSpy } = await boot(4862);
    await bootstrapAdmin(base, logSpy);

    // Simulate the second boot's ready-check against the same store state.
    logSpy.mockClear();
    expect((await service.listUsers()).length).toBe(1);

    const page = await fetch(`${base}/auth/login?next=/admin`);
    expect(page.status).toBe(200);
    const text = await page.text();
    expect(text).toContain("Sign in");
    // No methods installed yet → the page says so instead of a dead end.
    expect(text).toContain("No login methods");
  });

  it("magic-link-style token: issue → callback sets cookie → single-use", async () => {
    const { base, service, logSpy } = await boot(4863);
    await bootstrapAdmin(base, logSpy);

    const issued = await service.issueToken({ purpose: "login", email: "ada@x.io", data: { next: "/secret" } });
    const cb = await fetch(`${base}${issued.path}`, { redirect: "manual" });
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe("/secret");
    const cookie = cookieOf(cb);
    expect(cookie).toMatch(/^pattern_session=/);

    const who = await fetch(`${base}/auth/whoami`, { headers: { cookie } });
    expect((await who.json()).email).toBe("ada@x.io");

    // Replaying the link fails closed.
    const replay = await fetch(`${base}${issued.path}`, { redirect: "manual" });
    expect(replay.status).toBe(302);
    expect(replay.headers.get("location")).toContain("error=invalid-token");

    // Garbage tokens too.
    const bad = await fetch(`${base}/auth/token?t=nope`, { redirect: "manual" });
    expect(bad.headers.get("location")).toContain("error=invalid-token");
  });

  it("signup policy: invite-only refuses unknown emails, open creates them", async () => {
    const closed = await boot(4864);
    await bootstrapAdmin(closed.base, closed.logSpy);
    const t1 = await closed.service.issueToken({ purpose: "login", email: "stranger@x.io" });
    const refused = await fetch(`${closed.base}${t1.path}`, { redirect: "manual" });
    expect(refused.headers.get("location")).toContain("error=signup-closed");
    await closer!();
    closer = undefined;

    const open = await boot(4865, { signup: "open" });
    const t2 = await open.service.issueToken({ purpose: "login", email: "stranger@x.io" });
    const welcomed = await fetch(`${open.base}${t2.path}`, { redirect: "manual" });
    expect(welcomed.status).toBe(302);
    expect(cookieOf(welcomed)).toMatch(/^pattern_session=/);
    const who = await fetch(`${open.base}/auth/whoami`, { headers: { cookie: cookieOf(welcomed) } });
    const me = await who.json();
    expect(me.email).toBe("stranger@x.io");
    expect(me.roles).toEqual([]); // open signup grants no roles
  });

  it("invite flow: invited user lands with the granted roles", async () => {
    const { base, service, logSpy } = await boot(4866);
    await bootstrapAdmin(base, logSpy);

    const invite = await service.issueToken({
      purpose: "invite",
      email: "new@x.io",
      data: { roles: ["admin"] },
    });
    const cb = await fetch(`${base}${invite.path}`, { redirect: "manual" });
    expect(cb.status).toBe(302);
    const who = await fetch(`${base}/auth/whoami`, { headers: { cookie: cookieOf(cb) } });
    const me = await who.json();
    expect(me.email).toBe("new@x.io");
    expect(me.roles).toEqual(["admin"]);
  });

  it("real second boot (sqlite file): users persist, no re-bootstrap", async () => {
    if (!process.getBuiltinModule?.("node:sqlite")) return; // memory driver covered elsewhere
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dbPath = join(mkdtempSync(join(tmpdir(), "pattern-identity-")), "identity.db");

    const first = await boot(4868, { storage: dbPath });
    const cookie = await bootstrapAdmin(first.base, first.logSpy, "persist@x.io");
    expect(cookie).toMatch(/^pattern_session=/);
    await closer!();
    closer = undefined;
    vi.restoreAllMocks();

    // Fresh engine, same database: the user is there, no bootstrap link prints,
    // and the cookie from boot #1 still authenticates (sessions persist too).
    const second = await boot(4869, { storage: dbPath });
    expect((await second.service.listUsers())[0]?.email).toBe("persist@x.io");
    expect(second.logSpy.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("bootstrap?t=");
    const who = await fetch(`${second.base}/auth/whoami`, { headers: { cookie } });
    expect((await who.json()).email).toBe("persist@x.io");
  });

  it("refuses open redirects in next", async () => {
    const { base, service, logSpy } = await boot(4867);
    await bootstrapAdmin(base, logSpy);
    const issued = await service.issueToken({
      purpose: "login",
      email: "ada@x.io",
      data: { next: "https://evil.example/phish" },
    });
    const cb = await fetch(`${base}${issued.path}`, { redirect: "manual" });
    expect(cb.headers.get("location")).toBe("/");
  });
});
