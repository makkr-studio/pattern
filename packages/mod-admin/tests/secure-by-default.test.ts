import { describe, it, expect, afterEach, vi } from "vitest";
import { Engine, IDENTITY_SERVICE, type PatternMod } from "@pattern/core";
import { createHttpHost } from "@pattern/runtime-node";
import { identityMod, type IdentityService } from "@pattern/mod-identity";
import { adminMod } from "../src/index.js";

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
  vi.restoreAllMocks();
});

/** Install like loadMods does: all setups first, then readies in order. */
async function install(engine: Engine, mods: PatternMod[]) {
  for (const mod of mods) await engine.useAsync(mod, { deferReady: true });
  for (const mod of mods) await mod.ready?.(engine);
}

const requireAuthOf = (engine: Engine, workflowId: string): unknown =>
  (engine.workflows.get(workflowId)?.nodes.find((n) => n.op.startsWith("boundary.http."))?.config as
    | { requireAuth?: unknown }
    | undefined)?.requireAuth;

describe("admin secure-by-default (§9)", () => {
  it("stamps every admin endpoint + the SPA when identity is installed", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const engine = new Engine();
    await install(engine, [adminMod(), identityMod({ storage: "memory" })]); // admin listed FIRST — still works

    expect(requireAuthOf(engine, "admin.api.workflows.list")).toEqual({ scopes: ["admin"] });
    expect(requireAuthOf(engine, "admin.spa")).toEqual({ scopes: ["admin"] });
    // Identity's own routes stay public (you must be able to log in).
    expect(requireAuthOf(engine, "identity.route.login")).toBeUndefined();
  });

  it("leaves the admin open without identity, or with an explicit auth:false", async () => {
    const engine = new Engine();
    await install(engine, [adminMod()]);
    expect(requireAuthOf(engine, "admin.api.workflows.list")).toBeUndefined();

    vi.spyOn(console, "log").mockImplementation(() => {});
    const engine2 = new Engine();
    await install(engine2, [identityMod({ storage: "memory" }), adminMod({ auth: false })]);
    expect(requireAuthOf(engine2, "admin.api.workflows.list")).toBeUndefined();
  });

  it("explicit auth options are respected, not overridden", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const engine = new Engine();
    await install(engine, [identityMod({ storage: "memory" }), adminMod({ auth: { scopes: ["ops"] } })]);
    expect(requireAuthOf(engine, "admin.api.workflows.list")).toEqual({ scopes: ["ops"] });
  });

  it("over HTTP: 401 without a session, 200 with an admin cookie, SPA 302s to login", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const engine = new Engine();
    await install(engine, [identityMod({ storage: "memory" }), adminMod()]);
    const { close } = await createHttpHost(engine, { defaultPort: 4891 }).start();
    closer = close;
    const base = "http://localhost:4891";

    // API: bare 401 for fetch-style requests.
    expect((await fetch(`${base}/admin/api/workflows`)).status).toBe(401);

    // SPA: a browser gets bounced to the login page instead.
    const spa = await fetch(`${base}/admin`, { headers: { accept: "text/html" }, redirect: "manual" });
    expect(spa.status).toBe(302);
    expect(spa.headers.get("location")).toBe("/auth/login?next=%2Fadmin");

    // Bootstrap an admin via the console link, then everything opens.
    const token = /bootstrap\?t=([A-Za-z0-9_-]+)/.exec(logSpy.mock.calls.map((c) => String(c[0])).join("\n"))?.[1];
    const submit = await fetch(`${base}/auth/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ t: token!, email: "root@x.io" }).toString(),
      redirect: "manual",
    });
    // The admin advertises AUTH_HOME_URL → bootstrap lands on /admin, not "/".
    expect(submit.headers.get("location")).toBe("/admin");
    const cookie = (submit.headers.get("set-cookie") ?? "").split(";")[0]!;

    const api = await fetch(`${base}/admin/api/workflows`, { headers: { cookie } });
    expect(api.status).toBe(200);
    const spaAuthed = await fetch(`${base}/admin`, { headers: { accept: "text/html", cookie } });
    expect(spaAuthed.status).toBe(200);

    // The privileged identity ops ride the admin invoke path with the cookie.
    const svc = engine.service<IdentityService>(IDENTITY_SERVICE)!;
    expect(svc).toBeTruthy();
    const invoke = await fetch(`${base}/admin/api/invoke`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ source: "identity.users.list" }),
    });
    expect(invoke.status).toBe(200);
    const users = await invoke.json();
    expect(users.map((u: { email: string }) => u.email)).toEqual(["root@x.io"]);

    // The admin can mint a sign-in link for manual delivery — and it works.
    const mint = await fetch(`${base}/admin/api/invoke`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ source: "identity.users.loginLink", input: { userId: users[0].id } }),
    });
    expect(mint.status).toBe(200);
    const { copy } = await mint.json(); // `copy` = the result-view's copyable-field convention
    expect(copy).toMatch(/^\/auth\/token\?t=/);
    const follow = await fetch(`${base}${copy}`, { redirect: "manual" });
    expect(follow.status).toBe(302);
    expect(follow.headers.get("set-cookie")).toMatch(/pattern_session=/);

    // The settings ops round-trip through the invoke path (the Settings page's
    // contributed sections use exactly this), and the manifest carries the section.
    const set = await fetch(`${base}/admin/api/invoke`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ source: "identity.settings.set", input: { signup: "open" } }),
    });
    expect((await set.json()).signup).toBe("open");
    const get = await fetch(`${base}/admin/api/invoke`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ source: "identity.settings.get" }),
    });
    expect((await get.json()).signup).toBe("open");

    const manifest = await (await fetch(`${base}/admin/api/ui/manifest`, { headers: { cookie } })).json();
    const identitySection = (manifest.settings ?? []).find(
      (s: { section: { id: string } }) => s.section.id === "identity",
    );
    expect(identitySection?.section.fields[0]?.key).toBe("signup");

    // …and the same invoke WITHOUT the admin scope hits the in-op guard
    // (defense in depth below the route stamp).
    const anon = await fetch(`${base}/admin/api/invoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "identity.users.list" }),
    });
    expect(anon.status).toBe(401); // stamped route refuses before the op even runs
  });

  it("in-op scope guard holds even when the admin is explicitly open", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const engine = new Engine();
    await install(engine, [identityMod({ storage: "memory" }), adminMod({ auth: false })]);
    const { close } = await createHttpHost(engine, { defaultPort: 4892 }).start();
    closer = close;

    // The invoke route is open (auth:false), but the op itself refuses an
    // anonymous principal — privileged identity data never leaks through an
    // open admin.
    const res = await fetch("http://localhost:4892/admin/api/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "identity.users.list" }),
    });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(await res.json())).toContain("admin");
  });
});
