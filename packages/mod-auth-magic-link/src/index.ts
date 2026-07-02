/**
 * @pattern-js/mod-auth-magic-link — email magic-link login (§9).
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

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { localFs, provideFilesystem } from "@pattern-js/runtime-node";
import { defineMod, value, z, type Engine, type OpDefinition, type PatternMod, type Workflow } from "@pattern-js/core";
import {
  deliverToken,
  identityService,
  IDENTITY_SERVICE,
  looksLikeEmail,
  renderSentPage,
  safeNextPath,
  type IdentityService,
} from "@pattern-js/mod-identity";

/* ── the op ────────────────────────────────────────────────────────────── */

/**
 * `auth.magiclink.request` — issue a login token for an email and deliver it.
 *
 * Issuance is GATED, not just the callback: a token is minted only for a
 * known, enabled user — or for an unknown email when signup is open. Anything
 * else does no work and sends nothing (delivery costs money and an open
 * issuer is a spam relay). The response is byte-identical either way, so
 * nothing leaks about who exists. Accepts a browser form post (urlencoded)
 * or JSON `{ email, next? }`.
 */
const requestOp: OpDefinition = {
  type: "auth.magiclink.request",
  title: "auth.magiclink.request",
  description:
    'Issue a single-use login link for an email and deliver it via the "identity.deliverToken" ' +
    "hook (console fallback). Always responds identically — no account enumeration.",
  reusable: false,
  // Pure: the workflow decomposes the form (the host parses urlencoded → an
  // object) into these ports + the request url (for the absolute link origin).
  inputs: {
    email: value(z.string().optional()),
    next: value(z.string().optional()),
    url: value(z.string().optional()),
  },
  outputs: { html: value() },
  execute: async (ctx) => {
    const [emailIn, nextIn, urlIn] = await Promise.all([
      ctx.input.has("email") ? ctx.input.value("email") : undefined,
      ctx.input.has("next") ? ctx.input.value("next") : undefined,
      ctx.input.has("url") ? ctx.input.value("url") : undefined,
    ]);
    const svc = identityService(ctx);
    const email = String(emailIn ?? "").trim();
    const next = safeNextPath(nextIn);
    let origin: string | undefined;
    try {
      if (typeof urlIn === "string" && urlIn) origin = new URL(urlIn).origin;
    } catch {
      /* a malformed url just yields a relative link */
    }

    if (looksLikeEmail(email)) {
      const user = await svc.findUserByEmail(email);
      const shouldIssue = user ? !user.disabled : (await svc.getSignup()) === "open";
      if (shouldIssue) {
        const issued = await svc.issueToken({ purpose: "login", email, data: { next } });
        await deliverToken(ctx, { email, path: issued.path, purpose: "login", origin });
      }
    }
    // Identical response either way — nothing leaks about who exists or
    // whether anything was sent. The workflow sets the text/html content-type.
    return { html: renderSentPage(looksLikeEmail(email) ? email : "that address") };
  },
};

/* ── the route ─────────────────────────────────────────────────────────── */

function requestRoute(mount: string): Workflow {
  return {
    id: "magic-link.route.request",
    name: `Identity · POST ${mount}/magic-link/request`,
    description:
      "The login form posts here: mint a single-use sign-in token and hand its link to the identity.deliverToken " +
      "hook (mod-email sends it; the console prints it otherwise). Responds with the \"check your email\" page.",
    source: "code",
    nodes: [
      { id: "in", op: "boundary.http.request", config: { method: "POST", path: `${mount}/magic-link/request` } },
      { id: "form", op: "core.object.extract", config: { keys: ["email", "next"] } },
      { id: "call", op: "auth.magiclink.request" },
      { id: "ct", op: "core.const.object", config: { value: { "content-type": "text/html; charset=utf-8" } } },
      { id: "out", op: "boundary.http.response", config: { mode: "buffered" } },
    ],
    edges: [
      { from: { node: "in", port: "body" }, to: { node: "form", port: "object" } },
      { from: { node: "form", port: "email" }, to: { node: "call", port: "email" } },
      { from: { node: "form", port: "next" }, to: { node: "call", port: "next" } },
      { from: { node: "in", port: "url" }, to: { node: "call", port: "url" } },
      { from: { node: "call", port: "html" }, to: { node: "out", port: "body" } },
      { from: { node: "ct", port: "out" }, to: { node: "out", port: "headers" } },
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


/** The packaged docs/ chapter (the `docs` contribution points at "magic-link-docs"). */
function packagedDocs(engine: Engine): void {
  try {
    const dir = fileURLToPath(new URL("../docs", import.meta.url));
    if (existsSync(dir)) provideFilesystem(engine, "magic-link-docs", localFs(dir));
  } catch {
    /* packaged without docs — the contribution is simply skipped */
  }
}

export function magicLinkMod(options: MagicLinkOptions = {}): PatternMod {
  const mount = (options.mount ?? "/auth").replace(/\/$/, "") || "/auth";
  return defineMod({
    name: "@pattern-js/mod-auth-magic-link",
    docs: { filesystem: "magic-link-docs", title: "Magic-link login", order: 41 },
    ops: [requestOp],
    workflows: [requestRoute(mount)],
    // `ready`, not `setup`: the identity service registers in identity's setup,
    // and every setup runs before any ready — order in the config is free.
    ready: (engine: Engine) => {
      packagedDocs(engine);
      const svc = engine.service<IdentityService>(IDENTITY_SERVICE);
      if (!svc) {
        console.error(
          "[pattern] @pattern-js/mod-auth-magic-link: identity service not found — add @pattern-js/mod-identity to your mods.",
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
