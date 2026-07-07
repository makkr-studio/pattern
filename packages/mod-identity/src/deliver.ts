/**
 * @pattern-js/mod-identity — token delivery (§ delivery hook).
 *
 * Delivery is a hook chain, not a hardcoded channel: `identity.deliverToken`
 * is invoked with `{ email, url, purpose, delivered: false }` and any
 * workflow subscribed via `boundary.hook` may deliver (email, SMS, chat …)
 * and flip `delivered`. If the payload comes back undelivered, the link is
 * printed to the server console — which is precisely the zero-config dev
 * login, and the same primitive bootstrap uses.
 */

import type { OpContext } from "@pattern-js/core";

export const DELIVER_TOKEN_HOOK = "identity.deliverToken";

export interface DeliverInput {
  email: string;
  /** Path-only callback URL from `issueToken` (e.g. "/auth/token?t=…"). */
  path: string;
  purpose: string;
  /** The request origin (e.g. "http://localhost:3000"), when available — makes the link absolute. */
  origin?: string | null;
  /** Token expiry (ms epoch) — turns "expires soon" into "valid for 7 days" in the copy. */
  expiresAt?: number;
}

export interface DeliverResult {
  delivered: boolean;
  url: string;
}

/** Best-effort absolute URL — `origin` (from the trigger's `url`) + the callback path. */
export function absoluteUrl(path: string, origin?: string | null): string {
  return origin ? `${origin.replace(/\/$/, "")}${path}` : path;
}

/**
 * The canonical public origin, when configured. `PATTERN_PUBLIC_URL` beats any
 * request-derived origin on purpose: behind a proxy or tunnel the Host header
 * is whatever the hop put there, and links minted outside a request (cron,
 * CLI) have no origin at all — an emailed link must survive both.
 */
function configuredOrigin(ctx: OpContext): string | null {
  const raw = ctx.env?.PATTERN_PUBLIC_URL;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/** "valid for 7 days" / "expires in 14 minutes" — humanized from the expiry stamp. */
function humanTtl(expiresAt: number | undefined): string | null {
  const ms = (expiresAt ?? 0) - Date.now();
  if (ms <= 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours <= 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Human copy per purpose. It lives HERE, not in the delivery workflow, because
 * identity owns the token's semantics (what it does, how long it lives) —
 * every channel subscribed to the hook (email, SMS, chat…) gets sensible
 * wording for free, and a forked delivery workflow may still write its own.
 */
function copyFor(purpose: string, ttl: string | null): { subject: string; message: string } {
  const expiry = ttl ? `The link is single-use and valid for ${ttl}.` : "The link is single-use and expires soon.";
  switch (purpose) {
    case "invite":
      return {
        subject: "You've been invited",
        message: `You've been invited to join. Open the link below to accept the invitation — your account is created on the spot, then you sign in for the first time. ${expiry}`,
      };
    case "login":
      return { subject: "Your sign-in link", message: `Open the link below to sign in. ${expiry}` };
    default:
      return { subject: `Your ${purpose} link`, message: `Open the link below to continue. ${expiry}` };
  }
}

export async function deliverToken(ctx: OpContext, input: DeliverInput): Promise<DeliverResult> {
  const url = absoluteUrl(input.path, configuredOrigin(ctx) ?? input.origin);
  const { subject, message } = copyFor(input.purpose, humanTtl(input.expiresAt));
  const payload = {
    email: input.email,
    url,
    purpose: input.purpose,
    delivered: false,
    subject,
    message,
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
  };
  let result: unknown;
  try {
    result = await ctx.services.hooks.invoke(DELIVER_TOKEN_HOOK, payload);
  } catch (err) {
    // A broken delivery workflow must never eat the login link.
    ctx.log("warn", `deliverToken hook failed; falling back to console: ${(err as Error).message}`);
    result = payload;
  }
  const delivered = Boolean((result as { delivered?: unknown } | undefined)?.delivered);
  if (!delivered) {
    console.log(
      `\n[pattern] ✉ ${input.purpose} link for ${input.email}\n` +
        `[pattern]   ${url}\n` +
        `[pattern]   (deliver these yourself by subscribing a workflow to the "${DELIVER_TOKEN_HOOK}" hook)\n`,
    );
  }
  return { delivered, url };
}
