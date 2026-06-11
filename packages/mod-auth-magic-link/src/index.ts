/**
 * @pattern/mod-auth-magic-link — email magic-link login (§9).
 *
 * The reference identity-provider mod, deliberately small enough to read in
 * one sitting: it proves the SPI. The split of labor —
 *
 *  - **mod-identity** owns the kernel: single-use tokens, the `/auth/token`
 *    callback that turns a consumed token into a user + session, the signup
 *    policy, the login page.
 *  - **this mod** owns the *flow*: a "request a link" route that issues a
 *    login token for an email and hands it to the `identity.deliverToken`
 *    hook (an email/SMS/chat workflow — or the console fallback, which is
 *    the zero-config dev login).
 *
 * It registers its login method in `ready` (after the identity service
 * exists — two-phase install), so listing order in pattern.config.json
 * doesn't matter.
 */

import { defineMod, value, z, type Engine, type OpDefinition, type PatternMod, type Workflow } from "@pattern/core";
import {
  deliverToken,
  identityService,
  IDENTITY_SERVICE,
  looksLikeEmail,
  renderSentPage,
  safeNextPath,
  type IdentityService,
} from "@pattern/mod-identity";

const stringRecord = z.record(z.string(), z.string());

/* ── the op ────────────────────────────────────────────────────────────── */

/**
 * `auth.magiclink.request` — issue a login token for an email and deliver it.
 *
 * Always answers with the same "check your inbox" page, whether or not the
 * email has an account (no enumeration); the *callback* enforces the signup
 * policy. Accepts a browser form post (urlencoded) or JSON `{ email, next? }`.
 */
const requestOp: OpDefinition = {
  type: "auth.magiclink.request",
  title: "auth.magiclink.request",
  description:
    'Issue a single-use login link for an email and deliver it via the "identity.deliverToken" ' +
    "hook (console fallback). Always responds identically — no account enumeration.",
  reusable: false,
  inputs: {
    query: value(z.record(z.string(), z.unknown())),
    body: value(z.unknown()),
    headers: value(stringRecord),
  },
  outputs: { status: value(z.number()), headers: value(stringRecord), body: value() },
  execute: async (ctx) => {
    const [query, body, headers] = await Promise.all([
      ctx.input.value("query"),
      ctx.input.value("body"),
      ctx.input.value("headers"),
    ]);
    const args: Record<string, unknown> =
      typeof body === "string"
        ? Object.fromEntries(new URLSearchParams(body).entries())
        : { ...((body as Record<string, unknown>) ?? {}) };
    const q = (query as Record<string, unknown>) ?? {};

    const svc = identityService(ctx);
    const email = String(args.email ?? "").trim();
    const next = safeNextPath(args.next ?? q.next);

    if (looksLikeEmail(email)) {
      const issued = await svc.issueToken({ purpose: "login", email, data: { next } });
      await deliverToken(ctx, {
        email,
        path: issued.path,
        purpose: "login",
        headers: (headers ?? null) as Record<string, string> | null,
      });
    }
    // Identical response either way — and a beat of work even for bad input
    // keeps timing flat enough for a login page.
    return {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: renderSentPage(looksLikeEmail(email) ? email : "that address"),
    };
  },
};

/* ── the route ─────────────────────────────────────────────────────────── */

function requestRoute(mount: string): Workflow {
  return {
    id: "magic-link.route.request",
    name: `Identity · POST ${mount}/magic-link/request`,
    source: "code",
    nodes: [
      { id: "in", op: "boundary.http.request", config: { method: "POST", path: `${mount}/magic-link/request` } },
      { id: "call", op: "auth.magiclink.request" },
      { id: "out", op: "boundary.http.response", config: { mode: "buffered" } },
    ],
    edges: [
      { from: { node: "in", port: "query" }, to: { node: "call", port: "query" } },
      { from: { node: "in", port: "body" }, to: { node: "call", port: "body" } },
      { from: { node: "in", port: "headers" }, to: { node: "call", port: "headers" } },
      { from: { node: "call", port: "status" }, to: { node: "out", port: "status" } },
      { from: { node: "call", port: "headers" }, to: { node: "out", port: "headers" } },
      { from: { node: "call", port: "body" }, to: { node: "out", port: "body" } },
    ],
  };
}

/* ── the mod ───────────────────────────────────────────────────────────── */

export interface MagicLinkOptions {
  /** Must match the identity mod's mount. Default "/auth". */
  mount?: string;
  /** Label on the login page. Default "Send me a sign-in link". */
  label?: string;
}

export function magicLinkMod(options: MagicLinkOptions = {}): PatternMod {
  const mount = (options.mount ?? "/auth").replace(/\/$/, "") || "/auth";
  return defineMod({
    name: "@pattern/mod-auth-magic-link",
    ops: [requestOp],
    workflows: [requestRoute(mount)],
    // `ready`, not `setup`: the identity service registers in identity's setup,
    // and every setup runs before any ready — order in the config is free.
    ready: (engine: Engine) => {
      const svc = engine.service<IdentityService>(IDENTITY_SERVICE);
      if (!svc) {
        console.error(
          "[pattern] @pattern/mod-auth-magic-link: identity service not found — add @pattern/mod-identity to your mods.",
        );
        return;
      }
      svc.registerLoginMethod({
        id: "magic-link",
        label: options.label ?? "Send me a sign-in link",
        kind: "form",
        startUrl: `${mount}/magic-link/request`,
        fields: [{ name: "email", label: "Email", type: "email" }],
      });
    },
  });
}

/** Ready-to-use with defaults (for `loadMods`/`engine.use`). */
export default magicLinkMod();
