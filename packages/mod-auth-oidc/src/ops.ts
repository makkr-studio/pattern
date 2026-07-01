/**
 * @pattern-js/mod-auth-oidc — the two flow ops.
 *
 * `auth.oidc.start` builds the authorization redirect (state + nonce + PKCE
 * S256), stashing the flow state in a short-lived per-provider cookie.
 * `auth.oidc.callback` validates state, exchanges the code, verifies the ID
 * token with jose (issuer, audience, and the nonce — jose doesn't check
 * nonce), then hands the verified identity to mod-identity: find-or-create →
 * mint session → redirect with the session cookie. Ops stay HTTP-free — like
 * mod-identity's auth ops they output { body, redirect, cookies, status } and
 * the route workflow wires those onto the response.
 *
 * Every failure is a redirect to the login page with a FIXED error code;
 * IdP-supplied text is only ever logged (never reflected into a URL or page).
 */

import { value, z, type OpContext, type OpDefinition } from "@pattern-js/core";
import { identityService, safeNextPath } from "@pattern-js/mod-identity";
import { jwtVerify } from "jose";
import type { OidcProvider, ResolvedOidcOptions } from "./options.js";
import type { OidcRuntime } from "./discovery.js";
import { resolveSourced } from "./secrets.js";
import { decodeState, encodeState, pkceChallenge, randomToken, stateCookieName } from "./state.js";

const DEFAULT_SCOPES = ["openid", "email", "profile"];

interface Quartet {
  [key: string]: unknown; // OpExecute returns a loose output record
  body: unknown;
  redirect: string | null;
  cookies: Record<string, unknown> | null;
  status: number | null;
}

const quartetOutputs = {
  body: value(),
  redirect: value(z.string()),
  cookies: value(z.record(z.string(), z.unknown())),
  status: value(z.number()),
};

const clearStateCookie = (id: string, secure: boolean): Record<string, unknown> => ({
  [stateCookieName(id)]: { value: "", maxAge: 0, secure },
});

async function input(ctx: OpContext, port: string): Promise<string | undefined> {
  if (!ctx.input.has(port)) return undefined;
  const v = await ctx.input.value(port);
  return typeof v === "string" && v ? v : undefined;
}

function originOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
}

export function buildOps(opts: ResolvedOidcOptions, runtime: OidcRuntime): OpDefinition[] {
  const providers = new Map<string, OidcProvider>(opts.providers.map((p) => [p.id, p]));
  const login = `${opts.mount}/login`;

  function providerOf(ctx: OpContext): OidcProvider {
    const id = (ctx.config as { provider: string }).provider;
    const p = providers.get(id);
    if (!p) throw new Error(`mod-auth-oidc: no provider "${id}" is configured.`);
    return p;
  }

  const startOp: OpDefinition = {
    type: "auth.oidc.start",
    title: "auth.oidc.start",
    description:
      "Begin an OIDC login: mint state/nonce/PKCE, stash them in a short-lived cookie and redirect " +
      "to the provider's authorization endpoint. config: { provider } (a configured provider id).",
    reusable: false,
    config: z.object({ provider: z.string() }),
    inputs: {
      next: value(z.string().optional()),
      url: value(z.string().optional()),
    },
    outputs: quartetOutputs,
    execute: async (ctx): Promise<Quartet> => {
      const p = providerOf(ctx);
      const svc = identityService(ctx);
      const secure = svc.options.cookieSecure;
      const fail = (code: string): Quartet => ({
        body: null,
        redirect: `${login}?error=${code}`,
        cookies: clearStateCookie(p.id, secure),
        status: null,
      });
      try {
        const [next, url] = await Promise.all([input(ctx, "next"), input(ctx, "url")]);
        const origin = originOf(url);
        if (!origin) {
          ctx.log("warn", `oidc[${p.id}]: request carried no absolute url — cannot build redirect_uri`);
          return fail("oidc-failed");
        }
        const disco = await runtime.discovery(p.issuer);
        const state = randomToken(16);
        const nonce = randomToken(16);
        const verifier = randomToken(32);

        const authorize = new URL(disco.authorization_endpoint);
        authorize.searchParams.set("response_type", "code");
        authorize.searchParams.set("client_id", p.clientId);
        authorize.searchParams.set("redirect_uri", `${origin}${opts.mount}/oidc/${p.id}/callback`);
        authorize.searchParams.set("scope", (p.scopes ?? DEFAULT_SCOPES).join(" "));
        authorize.searchParams.set("state", state);
        authorize.searchParams.set("nonce", nonce);
        authorize.searchParams.set("code_challenge", pkceChallenge(verifier));
        authorize.searchParams.set("code_challenge_method", "S256");

        return {
          body: null,
          redirect: authorize.toString(),
          cookies: {
            [stateCookieName(p.id)]: {
              value: encodeState({ v: 1, state, nonce, verifier, next: safeNextPath(next) }),
              maxAge: 600,
              secure,
            },
          },
          status: null,
        };
      } catch (err) {
        ctx.log("warn", `oidc[${p.id}]: start failed: ${err instanceof Error ? err.message : String(err)}`);
        return fail("oidc-failed");
      }
    },
  };

  const callbackOp: OpDefinition = {
    type: "auth.oidc.callback",
    title: "auth.oidc.callback",
    description:
      "Finish an OIDC login: validate state, exchange the code (PKCE + client secret), verify the " +
      "ID token (issuer, audience, nonce; email must be verified unless the provider opts out), " +
      "then find-or-create the user and mint a session. config: { provider }.",
    reusable: false,
    config: z.object({ provider: z.string() }),
    inputs: {
      code: value(z.string().optional()),
      state: value(z.string().optional()),
      error: value(z.string().optional()),
      error_description: value(z.string().optional()),
      cookies: value(z.record(z.string(), z.string()).optional()),
      url: value(z.string().optional()),
      userAgent: value(z.string().optional()),
    },
    outputs: quartetOutputs,
    execute: async (ctx): Promise<Quartet> => {
      const p = providerOf(ctx);
      const svc = identityService(ctx);
      const secure = svc.options.cookieSecure;
      const fail = (code: string): Quartet => ({
        body: null,
        redirect: `${login}?error=${code}`,
        cookies: clearStateCookie(p.id, secure),
        status: null,
      });
      try {
        const [code, state, idpError, idpErrorDescription, url, userAgent] = await Promise.all([
          input(ctx, "code"),
          input(ctx, "state"),
          input(ctx, "error"),
          input(ctx, "error_description"),
          input(ctx, "url"),
          input(ctx, "userAgent"),
        ]);
        const cookies = ctx.input.has("cookies")
          ? ((await ctx.input.value("cookies")) as Record<string, string> | undefined)
          : undefined;

        // 1. The IdP reported an error — log its text, never reflect it.
        if (idpError) {
          ctx.log("warn", `oidc[${p.id}]: provider returned "${idpError}"${idpErrorDescription ? `: ${idpErrorDescription}` : ""}`);
          return fail("oidc-failed");
        }

        // 2. The flow cookie must exist and its state must match the query's.
        const st = decodeState(cookies?.[stateCookieName(p.id)]);
        if (!st || !state || state !== st.state) return fail("oidc-state");
        if (!code) return fail("oidc-failed");

        // 3. Exchange the code — PKCE verifier + client secret.
        const disco = await runtime.discovery(p.issuer);
        const origin = originOf(url);
        if (!origin) return fail("oidc-failed");
        const exchange = await fetch(disco.token_endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: `${origin}${opts.mount}/oidc/${p.id}/callback`,
            client_id: p.clientId,
            client_secret: await resolveSourced(ctx, p.clientSecret),
            code_verifier: st.verifier,
          }).toString(),
        });
        if (!exchange.ok) {
          ctx.log("warn", `oidc[${p.id}]: token exchange failed (${exchange.status})`);
          return fail("oidc-exchange");
        }
        const tokens = (await exchange.json().catch(() => ({}))) as { id_token?: string };
        if (typeof tokens.id_token !== "string" || !tokens.id_token) return fail("oidc-exchange");

        // 4. Verify the ID token. jose checks signature/issuer/audience/exp;
        //    the nonce is ours to check (binds the token to THIS browser flow).
        let claims: Record<string, unknown>;
        try {
          const verified = await jwtVerify(tokens.id_token, runtime.keysFor(disco.jwks_uri), {
            issuer: disco.issuer,
            audience: p.clientId,
          });
          claims = verified.payload as Record<string, unknown>;
        } catch (err) {
          ctx.log("warn", `oidc[${p.id}]: id_token verification failed: ${err instanceof Error ? err.message : String(err)}`);
          return fail("oidc-token");
        }
        if (claims.nonce !== st.nonce) return fail("oidc-token");
        const sub = claims.sub;
        if (typeof sub !== "string" || !sub) return fail("oidc-token");

        // 5. Email policy: identity links accounts BY EMAIL, so only a
        //    verified claim may sign in (see options.ts on the opt-out).
        const email = typeof claims.email === "string" ? claims.email : undefined;
        if (!email) return fail("oidc-no-email");
        if (claims.email_verified !== true && !p.allowUnverifiedEmail) return fail("email-not-verified");

        // 6. The identity SPI: find-or-create per the EFFECTIVE signup policy,
        //    mint the session, set the cookie, go where the user was headed.
        const user = await svc.findOrCreateByIdentity({
          provider: `oidc:${p.id}`,
          subject: sub,
          email,
          name: typeof claims.name === "string" ? claims.name : undefined,
          allowCreate: (await svc.getSignup()) === "open",
        });
        if (!user) return fail("signup-closed");
        if (user.disabled) return fail("account-disabled");

        const minted = await svc.mintSession(user.id, { userAgent: userAgent ?? null });
        return {
          body: null,
          redirect: safeNextPath(st.next),
          cookies: {
            [svc.options.cookieName]: {
              value: minted.token,
              maxAge: Math.floor(svc.options.sessionTtlMs / 1000),
              secure,
            },
            ...clearStateCookie(p.id, secure),
          },
          status: null,
        };
      } catch (err) {
        ctx.log("warn", `oidc[${p.id}]: callback failed: ${err instanceof Error ? err.message : String(err)}`);
        return fail("oidc-failed");
      }
    },
  };

  return [startOp, callbackOp];
}
