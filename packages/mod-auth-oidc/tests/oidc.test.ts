import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Engine } from "@pattern-js/core";
import { createHttpHost } from "@pattern-js/runtime-node";
import { identityMod, IDENTITY_SERVICE, type IdentityService } from "@pattern-js/mod-identity";
import { oidcMod } from "../src/index.js";
import { startFakeIdp, type FakeIdp } from "./fake-idp.js";

const IDP_PORT = 5110;
let idp: FakeIdp;
beforeAll(async () => {
  idp = await startFakeIdp(IDP_PORT);
});
afterAll(async () => {
  await idp.close();
});

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
  idp.claims = { sub: "idp-user-1", email: "ada@x.io", email_verified: true, name: "Ada" };
  idp.tokenRequests.length = 0;
});

async function boot(port: number, opts: { signup?: "open" | "invite"; second?: boolean } = {}) {
  const engine = new Engine({ env: { OIDC_TEST_SECRET: "shhh" } });
  const providers = [
    {
      id: "test",
      label: "Continue with TestIdP",
      issuer: idp.issuer,
      clientId: "client-1",
      clientSecret: { source: "env" as const, key: "OIDC_TEST_SECRET" },
    },
    ...(opts.second
      ? [
          {
            id: "other",
            issuer: idp.issuer,
            clientId: "client-2",
            clientSecret: { source: "env" as const, key: "OIDC_TEST_SECRET" },
          },
        ]
      : []),
  ];
  const mods = [identityMod({ storage: "memory", signup: opts.signup ?? "open" }), oidcMod({ providers })];
  for (const mod of mods) await engine.useAsync(mod, { deferReady: true });
  for (const mod of mods) await mod.ready?.(engine);
  const { close } = await createHttpHost(engine, { defaultPort: port }).start();
  closer = close;
  const service = engine.service<IdentityService>(IDENTITY_SERVICE)!;
  return { base: `http://localhost:${port}`, service };
}

const cookieList = (res: Response): string[] => res.headers.getSetCookie();
const cookiePair = (res: Response, name: string): string | undefined =>
  cookieList(res)
    .find((c) => c.startsWith(`${name}=`))
    ?.split(";")[0];

/** Drive start → (skip the IdP page) → callback, using the nonce-as-code trick. */
async function drive(base: string, opts: { next?: string; provider?: string; breakState?: boolean } = {}) {
  const provider = opts.provider ?? "test";
  const startUrl = `${base}/auth/oidc/${provider}/start${opts.next ? `?next=${encodeURIComponent(opts.next)}` : ""}`;
  const start = await fetch(startUrl, { redirect: "manual" });
  const authorize = new URL(start.headers.get("location")!);
  const stateCookie = cookiePair(start, `pattern_oidc_${provider}`)!;
  const state = opts.breakState ? "not-the-state" : authorize.searchParams.get("state")!;
  const code = authorize.searchParams.get("nonce")!; // the fake IdP echoes code → nonce claim
  const cb = await fetch(`${base}/auth/oidc/${provider}/callback?code=${code}&state=${state}`, {
    redirect: "manual",
    headers: { cookie: stateCookie },
  });
  return { start, authorize, cb };
}

describe("@pattern-js/mod-auth-oidc", () => {
  it("happy path: authorize redirect (PKCE), code exchange, verified token → session cookie → whoami", async () => {
    const { base } = await boot(5105);

    const { start, authorize, cb } = await drive(base, { next: "/admin" });

    // The authorize redirect carries the full spec-shaped request.
    expect(start.status).toBe(302);
    expect(authorize.origin).toBe(idp.issuer);
    expect(authorize.pathname).toBe("/authorize");
    expect(authorize.searchParams.get("response_type")).toBe("code");
    expect(authorize.searchParams.get("client_id")).toBe("client-1");
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${base}/auth/oidc/test/callback`);
    expect(authorize.searchParams.get("scope")).toBe("openid email profile");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("code_challenge")).toBeTruthy();
    const rawStateCookie = cookieList(start).find((c) => c.startsWith("pattern_oidc_test="))!;
    expect(rawStateCookie).toContain("HttpOnly");
    expect(rawStateCookie).toContain("Max-Age=600");

    // The callback minted a session and went where the user was headed.
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe("/admin");
    const session = cookiePair(cb, "pattern_session")!;
    expect(session).toBeTruthy();
    expect(cookieList(cb).find((c) => c.startsWith("pattern_oidc_test="))).toContain("Max-Age=0"); // flow cookie cleared

    const who = await (await fetch(`${base}/auth/whoami`, { headers: { cookie: session } })).json();
    expect(who.kind).toBe("user");
    expect(who.email).toBe("ada@x.io");
    expect(who.name).toBe("Ada");

    // The exchange carried PKCE + the env-sourced client secret.
    const exchange = idp.tokenRequests[0]!;
    expect(exchange.grant_type).toBe("authorization_code");
    expect(exchange.client_id).toBe("client-1");
    expect(exchange.client_secret).toBe("shhh");
    expect(exchange.code_verifier).toBeTruthy();
    expect(exchange.redirect_uri).toBe(`${base}/auth/oidc/test/callback`);
  });

  it("state mismatch → login?error=oidc-state, no session, no token exchange", async () => {
    const { base } = await boot(5106);
    const { cb } = await drive(base, { breakState: true });
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe("/auth/login?error=oidc-state");
    expect(cookiePair(cb, "pattern_session")).toBeUndefined();
    expect(idp.tokenRequests).toHaveLength(0);
  });

  it("unverified email → login?error=email-not-verified (linking by email needs a verified claim)", async () => {
    const { base } = await boot(5107);
    idp.claims.email_verified = false;
    const { cb } = await drive(base);
    expect(cb.headers.get("location")).toBe("/auth/login?error=email-not-verified");
    expect(cookiePair(cb, "pattern_session")).toBeUndefined();
  });

  it("signup closed → login?error=signup-closed for unknown emails", async () => {
    const { base } = await boot(5108, { signup: "invite" });
    const { cb } = await drive(base);
    expect(cb.headers.get("location")).toBe("/auth/login?error=signup-closed");
    expect(cookiePair(cb, "pattern_session")).toBeUndefined();
  });

  it("several providers render side by side on the login page, ?next= threaded", async () => {
    const { base } = await boot(5105, { second: true });
    const page = await (await fetch(`${base}/auth/login?next=%2Fadmin`)).text();
    expect(page).toContain("Continue with TestIdP");
    expect(page).toContain("Continue with other");
    expect(page).toContain("/auth/oidc/test/start?next=%2Fadmin");
    expect(page).toContain("/auth/oidc/other/start?next=%2Fadmin");
  });

  it("links by verified email: an existing magic-link user logs in via OIDC as the SAME user", async () => {
    const { base, service } = await boot(5106, { signup: "invite" });
    const existing = await service.findOrCreateByIdentity({
      provider: "magic-link",
      subject: "ada@x.io",
      email: "ada@x.io",
      allowCreate: true,
    });

    const { cb } = await drive(base);
    expect(cb.status).toBe(302);
    const session = cookiePair(cb, "pattern_session")!;
    const who = await (await fetch(`${base}/auth/whoami`, { headers: { cookie: session } })).json();
    expect(who.id).toBe(existing!.id); // linked, not duplicated — signup stayed closed
    expect((await service.listUsers()).length).toBe(1);
  });
});
