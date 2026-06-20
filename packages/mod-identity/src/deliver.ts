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
}

export interface DeliverResult {
  delivered: boolean;
  url: string;
}

/** Best-effort absolute URL — `origin` (from the trigger's `url`) + the callback path. */
export function absoluteUrl(path: string, origin?: string | null): string {
  return origin ? `${origin.replace(/\/$/, "")}${path}` : path;
}

export async function deliverToken(ctx: OpContext, input: DeliverInput): Promise<DeliverResult> {
  const url = absoluteUrl(input.path, input.origin);
  const payload = { email: input.email, url, purpose: input.purpose, delivered: false };
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
