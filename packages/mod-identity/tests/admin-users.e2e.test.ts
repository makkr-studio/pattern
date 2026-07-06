/**
 * User administration + invite management over the real admin routes (0.4):
 * absolute invite links (PATTERN_PUBLIC_URL beats the request origin), the
 * invites list with statuses + revocation, delete / set-roles / the guards
 * (self, last active admin). Ports 4876-4879 — http-flow holds 4861-4869, and
 * 4873 is verdaccio's default port (a local registry answers 404s): never use it.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { Engine, IDENTITY_SERVICE } from "@pattern-js/core";
import { createHttpHost } from "@pattern-js/runtime-node";
import { identityMod } from "../src/mod.js";
import type { IdentityService } from "../src/service.js";

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
  vi.restoreAllMocks();
});

async function boot(port: number, env: Record<string, string> = {}) {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const engine = new Engine({ env });
  await engine.useAsync(identityMod({ storage: "memory" }));
  const host = createHttpHost(engine, { defaultPort: port });
  const { close } = await host.start();
  closer = close;
  const service = engine.service<IdentityService>(IDENTITY_SERVICE)!;
  const base = `http://localhost:${port}`;
  return { engine, service, base, logSpy };
}

const cookieOf = (res: Response): string => (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

/** Bootstrap the first admin and hand back their session cookie. */
async function bootstrapAdmin(base: string, logSpy: ReturnType<typeof vi.spyOn>, email = "ada@x.io") {
  const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
  const token = /bootstrap\?t=([A-Za-z0-9_-]+)/.exec(printed)?.[1];
  expect(token, "bootstrap link printed to console").toBeTruthy();
  const submit = await fetch(`${base}/auth/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ t: token!, email, name: "Ada" }).toString(),
    redirect: "manual",
  });
  const cookie = cookieOf(submit);
  expect(cookie, `bootstrap submit → ${submit.status} ${submit.headers.get("location") ?? ""}`).toMatch(/^pattern_session=/);
  return cookie;
}

const json = { "content-type": "application/json" };

describe("user administration + invites over the admin routes (e2e)", () => {
  it("invite via route: absolute link (PATTERN_PUBLIC_URL wins), listed pending → accepted; revoked invites die", async () => {
    const { base, service, logSpy } = await boot(4876, { PATTERN_PUBLIC_URL: "https://app.example.com" });
    const cookie = await bootstrapAdmin(base, logSpy);

    // Send through the REAL admin route — the copy link must be absolute on
    // the configured origin, not the localhost the request came in on.
    const sent = await fetch(`${base}/admin/api/identity/invites`, {
      method: "POST",
      headers: { ...json, cookie },
      body: JSON.stringify({ email: "new@x.io", roles: "admin", next: "/admin" }),
    });
    expect(sent.status).toBe(200);
    const result = (await sent.json()) as { copy?: string; delivered: boolean; next?: string };
    expect(result.delivered).toBe(false); // no email channel wired
    expect(result.copy).toMatch(/^https:\/\/app\.example\.com\/auth\/token\?t=/);
    expect(result.next).toBe("/admin");

    // Listed, pending, with the next path and the sender.
    const list1 = (await (await fetch(`${base}/admin/api/identity/invites`, { headers: { cookie } })).json()) as Array<
      Record<string, string>
    >;
    expect(list1).toHaveLength(1);
    expect(list1[0]).toMatchObject({ email: "new@x.io", status: "pending", next: "/admin", "invited by": "ada@x.io" });

    // Accept (follow the emailed link, path part) → status flips.
    const path = new URL(result.copy!).pathname + new URL(result.copy!).search;
    const cb = await fetch(`${base}${path}`, { redirect: "manual" });
    expect(cb.headers.get("location")).toContain("/auth/invited");
    const list2 = (await (await fetch(`${base}/admin/api/identity/invites`, { headers: { cookie } })).json()) as Array<
      Record<string, string>
    >;
    expect(list2[0]!.status).toBe("accepted");

    // Revoking an accepted invite is refused (the account exists now)…
    const lateRevoke = await fetch(`${base}/admin/api/identity/invites/${list2[0]!.id}/revoke`, {
      method: "POST",
      headers: { ...json, cookie },
      body: "{}",
    });
    expect(lateRevoke.status).toBeGreaterThanOrEqual(400);

    // …while revoking a PENDING one kills its link before consumption.
    const { invite, issued } = await service.createInvite({ email: "later@x.io", roles: [] });
    await service.revokeInvite(invite.id);
    const dead = await fetch(`${base}${issued.path}`, { redirect: "manual" });
    expect(dead.headers.get("location")).toContain("error=invite-revoked");
    expect(await service.findUserByEmail("later@x.io")).toBeNull(); // no account was created
  });

  it("delete user: sessions die and the rows are gone; roles route replaces the set", async () => {
    const { base, service, logSpy } = await boot(4877);
    const cookie = await bootstrapAdmin(base, logSpy);

    const user = (await service.findOrCreateByIdentity({
      provider: "magic-link",
      subject: "mem@x.io",
      email: "mem@x.io",
      allowCreate: true,
    }))!;
    const minted = await service.mintSession(user.id);

    // Set roles over the route (the details-page form posts exactly this).
    const roled = await fetch(`${base}/admin/api/identity/users/${user.id}/roles`, {
      method: "POST",
      headers: { ...json, cookie },
      body: JSON.stringify({ roles: "editor, admin" }),
    });
    expect(roled.status).toBe(200);
    expect((await service.getUser(user.id))!.roles).toEqual(["editor", "admin"]);

    const del = await fetch(`${base}/admin/api/identity/users/${user.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(del.status).toBe(200);
    expect(await service.getUser(user.id)).toBeNull();
    expect(await service.resolveSessionByToken(minted.token)).toBeNull();
    expect(await service.listSessions(user.id)).toHaveLength(0); // hard-deleted, not just revoked
  });

  it("guards: no self-disable, no self-delete, and the last active admin is untouchable", async () => {
    const { base, service, logSpy } = await boot(4878);
    const cookie = await bootstrapAdmin(base, logSpy);
    const ada = (await service.findUserByEmail("ada@x.io"))!;

    const selfDisable = await fetch(`${base}/admin/api/identity/users/${ada.id}/toggle-disabled`, {
      method: "POST",
      headers: { ...json, cookie },
      body: "{}",
    });
    expect(selfDisable.status).toBeGreaterThanOrEqual(400);

    const selfDelete = await fetch(`${base}/admin/api/identity/users/${ada.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(selfDelete.status).toBeGreaterThanOrEqual(400);
    expect(await service.getUser(ada.id)).not.toBeNull();

    // Last-admin floor, service-level: demote / disable / delete all refuse.
    await expect(service.setRoles(ada.id, [])).rejects.toThrow(/last active admin/);
    await expect(service.setDisabled(ada.id, true)).rejects.toThrow(/last active admin/);
    await expect(service.deleteUser(ada.id)).rejects.toThrow(/last active admin/);

    // With a second admin the floor holds elsewhere — ada becomes removable.
    await service.findOrCreateByIdentity({
      provider: "magic-link",
      subject: "grace@x.io",
      email: "grace@x.io",
      allowCreate: true,
      roles: ["admin"],
    });
    await expect(service.setDisabled(ada.id, true)).resolves.toMatchObject({ disabled: true });
  });

  it("invite link without PATTERN_PUBLIC_URL falls back to the request origin (still absolute)", async () => {
    const { base, logSpy } = await boot(4879);
    const cookie = await bootstrapAdmin(base, logSpy);
    const sent = await fetch(`${base}/admin/api/identity/invites`, {
      method: "POST",
      headers: { ...json, cookie },
      body: JSON.stringify({ email: "dev@x.io" }),
    });
    const result = (await sent.json()) as { copy?: string };
    // The regression this whole file guards: the emailed/copyable link must
    // never be a bare path again.
    expect(result.copy).toMatch(new RegExp(`^${base}/auth/token\\?t=`));
  });
});
