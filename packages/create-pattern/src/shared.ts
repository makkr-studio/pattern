/**
 * create-pattern — pieces shared by the scaffolder (`index.ts`) and the
 * grow-an-existing-project command (`add.ts`): the mod-name constants, the
 * app-local wrapper file contents, and the .env.example hint helpers. One
 * source so `add billing` writes byte-identical wrappers to a fresh compose.
 */

import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const TEMPLATES_DIR = fileURLToPath(new URL("../templates", import.meta.url));

/**
 * The @pattern-js/* range every scaffold gets, derived from create-pattern's
 * OWN version (^major.minor.0) — a scaffold always resolves the mods published
 * alongside the CLI that created it. The static template package.jsons carry
 * whatever range was current when they were written; normalizeDepRanges
 * rewrites them at scaffold time, so they can never go stale. (`add` is the
 * one place this range does NOT apply: an existing project keeps ITS range.)
 */
export const SELF_VERSION = (JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { version: string }).version;
export const PATTERN_RANGE = `^${SELF_VERSION.split(".").slice(0, 2).join(".")}.0`;

export const ADMIN_MOD = "@pattern-js/mod-admin";
export const IDENTITY_MOD = "@pattern-js/mod-identity";
export const MAGIC_LINK_MOD = "@pattern-js/mod-auth-magic-link";
export const OIDC_MOD = "@pattern-js/mod-auth-oidc";
export const EMAIL_MOD = "@pattern-js/mod-email";
/** What the docs toggle adds: self-reflecting documentation at /docs. */
export const DOCS_MOD = "@pattern-js/mod-docs";

export const EMAIL_DRIVERS: Record<string, string> = {
  resend: "@pattern-js/mod-email-resend",
  smtp: "@pattern-js/mod-email-smtp",
};
export type EmailDelivery = "console" | "resend" | "smtp";

/**
 * The app-local identity wrapper the saas-starter writes: the roles→scopes map
 * is the second half of billing's entitlement bridge (mods/billing.mjs grants
 * the ROLE; this map turns it into the SCOPE routes gate on). Editing it
 * applies on the next request — scopes are compiled per request, not stored.
 */
export const IDENTITY_WRAPPER_SAAS = `/**
 * Identity, app-configured (docs: /docs → “Identity”).
 *
 * The roles→scopes map is half of the entitlement bridge: billing grants the
 * “member” role when a subscription is active (mods/billing.mjs), and this map
 * turns it into the “pro” scope — which requireAuth: { scopes: ["pro"] }
 * gates on. Add roles/scopes freely; changes apply on the next request.
 */
import { identityMod } from "@pattern-js/mod-identity";

export default identityMod({
  roles: {
    admin: ["admin"],
    member: ["pro"],
  },
});
`;

/**
 * The app-local OIDC wrapper the scaffold writes. The provider ships COMMENTED
 * OUT on purpose: the project boots clean (an empty provider list logs a hint
 * and contributes nothing), and the login button appears the moment a real
 * issuer + client id are filled in. The secret never lives in this file — it's
 * a { source, key } reference into env or the vault.
 */
export const OIDC_WRAPPER = `/**
 * OIDC sign-in — your providers, code-configured (docs: /docs → "OIDC login").
 *
 * Google, Microsoft, Keycloak, Auth0 — any OpenID Connect issuer works. Several
 * providers can sit side by side; each becomes a button on the login page.
 * OIDC composes with magic-link: the same verified email is the same user.
 */
import { oidcMod } from "@pattern-js/mod-auth-oidc";

export default oidcMod({
  providers: [
    // 1. Create an OAuth client at your IdP.
    // 2. Register the redirect URI:
    //      http://localhost:3000/auth/oidc/google/callback   (+ your production host)
    // 3. Uncomment, fill in, and set GOOGLE_CLIENT_SECRET in .env —
    //    the "Continue with Google" button appears on the login page.
    // {
    //   id: "google",
    //   label: "Continue with Google",
    //   issuer: "https://accounts.google.com",
    //   clientId: "1234567890-abc.apps.googleusercontent.com",
    //   clientSecret: { source: "env", key: "GOOGLE_CLIENT_SECRET" },
    // },
  ],
});
`;

/** The .env.example block a real email driver earns (null for console). */
export function emailEnvHint(delivery: EmailDelivery): string | null {
  if (delivery === "console") return null;
  const hint =
    delivery === "resend"
      ? "# Email (Resend): the API key lives here or in the vault (admin → System → Secrets)\n# RESEND_API_KEY=\n"
      : "# Email (SMTP): host/port/user are account options in admin → System → Email;\n# the password lives here or in the vault (admin → System → Secrets)\n# SMTP_PASSWORD=\n";
  return (
    hint +
    "\n# The app's public origin (e.g. https://app.example.com) — emailed links\n" +
    "# (invites, sign-in) are built on it. Unset in dev = the request's host.\n" +
    "# PATTERN_PUBLIC_URL=\n"
  );
}

/** Append a commented hint to .env.example, creating the file for templates that ship none. */
export async function appendEnvHint(targetDir: string, hint: string): Promise<void> {
  const envPath = join(targetDir, ".env.example");
  const current = existsSync(envPath) ? await readFile(envPath, "utf8") : "";
  await writeFile(envPath, current ? `${current.replace(/\n*$/, "\n")}\n${hint}` : hint);
}
