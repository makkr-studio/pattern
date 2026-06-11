import { describe, it, expect, afterEach, vi } from "vitest";
import { Engine, IDENTITY_SERVICE, type Workflow } from "@pattern/core";
import { createHttpHost } from "@pattern/runtime-node";
import { identityMod, type IdentityService } from "@pattern/mod-identity";
import { magicLinkMod } from "../src/index.js";

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
  vi.restoreAllMocks();
});

async function boot(port: number, opts: { listIdentityFirst?: boolean; signup?: "open" | "invite" } = {}) {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const engine = new Engine();
  // Two-phase install: register both with deferred ready, then ready in order —
  // exactly what loadMods does for pattern.config.json entries.
  const signup = opts.signup ?? "open";
  const mods =
    opts.listIdentityFirst === false
      ? [magicLinkMod(), identityMod({ storage: "memory", signup })]
      : [identityMod({ storage: "memory", signup }), magicLinkMod()];
  for (const mod of mods) await engine.useAsync(mod, { deferReady: true });
  for (const mod of mods) await mod.ready?.(engine);

  const { close } = await createHttpHost(engine, { defaultPort: port }).start();
  closer = close;
  const service = engine.service<IdentityService>(IDENTITY_SERVICE)!;
  return { engine, base: `http://localhost:${port}`, service, logSpy };
}

const requestLink = (base: string, body: Record<string, string>) =>
  fetch(`${base}/auth/magic-link/request`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });

const printedLink = (logSpy: ReturnType<typeof vi.spyOn>): string | undefined =>
  /(https?:\/\/\S*\/auth\/token\?t=\S+)/.exec(logSpy.mock.calls.map((c) => String(c[0])).join("\n"))?.[1];

describe("@pattern/mod-auth-magic-link", () => {
  it("registers its login method in either config order", async () => {
    const a = await boot(4881);
    expect(a.service.loginMethods().map((m) => m.id)).toContain("magic-link");
    await closer!();
    closer = undefined;

    const b = await boot(4882, { listIdentityFirst: false });
    expect(b.service.loginMethods().map((m) => m.id)).toContain("magic-link");
    // …and the login page actually shows the email form.
    const page = await fetch(`${b.base}/auth/login`);
    expect(await page.text()).toContain("magic-link/request");
  });

  it("full ride: form post → console link → callback → session cookie", async () => {
    const { base, logSpy } = await boot(4883);

    const res = await requestLink(base, { email: "ada@x.io", next: "/admin" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Check your inbox");

    // No delivery hook subscribed → the console fallback printed an absolute
    // URL built from the request's Host header.
    const link = printedLink(logSpy);
    expect(link).toBeTruthy();
    expect(link).toContain(`${base}/auth/token?t=`);

    const cb = await fetch(link!, { redirect: "manual" });
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe("/admin");
    const cookie = (cb.headers.get("set-cookie") ?? "").split(";")[0]!;

    const who = await fetch(`${base}/auth/whoami`, { headers: { cookie } });
    expect((await who.json()).email).toBe("ada@x.io");
  });

  it("answers identically for unknown emails and garbage (no enumeration)", async () => {
    const { base, logSpy } = await boot(4884);

    const unknown = await requestLink(base, { email: "ghost@x.io" });
    expect(unknown.status).toBe(200);
    expect(await unknown.text()).toContain("Check your inbox");

    logSpy.mockClear();
    const garbage = await requestLink(base, { email: "not-an-email" });
    expect(garbage.status).toBe(200);
    expect(await garbage.text()).toContain("Check your inbox");
    // …but no token was issued for garbage.
    expect(printedLink(logSpy)).toBeUndefined();
  });

  it("invite-only: no token is issued (or delivered) for unknown or disabled emails", async () => {
    const { base, service, logSpy } = await boot(4887, { signup: "invite" });

    // Unknown email: identical response, but NOTHING was minted or delivered.
    logSpy.mockClear();
    const unknown = await requestLink(base, { email: "stranger@x.io" });
    expect(unknown.status).toBe(200);
    expect(await unknown.text()).toContain("Check your inbox");
    expect(printedLink(logSpy)).toBeUndefined();

    // A real user gets a link…
    const user = await service.findOrCreateByIdentity({
      provider: "magic-link",
      subject: "ada@x.io",
      email: "ada@x.io",
      allowCreate: true,
    });
    logSpy.mockClear();
    await requestLink(base, { email: "ada@x.io" });
    expect(printedLink(logSpy)).toBeTruthy();

    // …until they're disabled — then issuance stops too (no wasted emails).
    await service.setDisabled(user!.id, true);
    logSpy.mockClear();
    const disabled = await requestLink(base, { email: "ada@x.io" });
    expect(disabled.status).toBe(200);
    expect(printedLink(logSpy)).toBeUndefined();
  });

  it("the runtime signup toggle opens and closes issuance for unknown emails", async () => {
    const { base, service, logSpy } = await boot(4888, { signup: "invite" });

    logSpy.mockClear();
    await requestLink(base, { email: "stranger@x.io" });
    expect(printedLink(logSpy)).toBeUndefined();

    await service.setSignup("open");
    logSpy.mockClear();
    await requestLink(base, { email: "stranger@x.io" });
    const link = printedLink(logSpy);
    expect(link).toBeTruthy();
    // The callback honors the same effective policy: the stranger gets in.
    const cb = await fetch(link!, { redirect: "manual" });
    expect((cb.headers.get("set-cookie") ?? "")).toMatch(/pattern_session=/);

    await service.setSignup("invite");
    logSpy.mockClear();
    await requestLink(base, { email: "another@x.io" });
    expect(printedLink(logSpy)).toBeUndefined();
  });

  it("a workflow subscribed to identity.deliverToken claims delivery (no console fallback)", async () => {
    const { engine, base, logSpy } = await boot(4886);

    // Delivery "channel": flips `delivered` on the hook payload — standing in
    // for an email/SMS workflow. Registered as an ordinary hook member.
    const deliver: Workflow = {
      id: "deliver-via-test",
      nodes: [
        { id: "in", op: "boundary.hook", config: { hook: "identity.deliverToken" } },
        { id: "flag", op: "core.const.boolean", config: { value: true } },
        { id: "set", op: "core.object.set", config: { path: "delivered" } },
        { id: "out", op: "boundary.hook.return" },
      ],
      edges: [
        { from: { node: "in", port: "payload" }, to: { node: "set", port: "object" } },
        { from: { node: "flag", port: "out" }, to: { node: "set", port: "value" } },
        { from: { node: "set", port: "out" }, to: { node: "out", port: "payload" } },
      ],
    };
    engine.registerWorkflow(deliver);

    logSpy.mockClear();
    const res = await requestLink(base, { email: "ada@x.io" });
    expect(res.status).toBe(200);
    expect(printedLink(logSpy)).toBeUndefined(); // hook claimed it — nothing printed
  });
});
