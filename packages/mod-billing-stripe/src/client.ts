/**
 * @pattern-js/mod-billing-stripe — the zero-dependency Stripe client.
 *
 * Stripe's v1 API is plain REST: Bearer auth, `application/x-www-form-
 * urlencoded` bodies with nested-bracket keys (`line_items[0][price]`), and a
 * pinned `Stripe-Version`. That's a form serializer and a fetch — no SDK.
 * Every POST carries an `Idempotency-Key` (Stripe replays the stored response
 * for ≥24h), so a network retry — ours or a durable workflow's — can never
 * create a second session or charge.
 */

const STRIPE_VERSION = "2026-06-24.dahlia";
const DEFAULT_API_BASE = "https://api.stripe.com";

/** Flatten a nested params object into Stripe's bracket form encoding. */
export function formEncode(params: Record<string, unknown>): string {
  const pairs: Array<[string, string]> = [];
  const walk = (key: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(`${key}[${i}]`, v));
    } else if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(`${key}[${k}]`, v);
    } else {
      pairs.push([key, typeof value === "boolean" ? (value ? "true" : "false") : String(value)]);
    }
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

/** Stripe's error envelope, surfaced as a located message. */
export class StripeApiError extends Error {
  constructor(
    readonly status: number,
    readonly type?: string,
    readonly code?: string,
    message?: string,
  ) {
    super(`stripe: ${status}${type ? ` ${type}` : ""}${code ? `/${code}` : ""}${message ? ` — ${message}` : ""}`);
    this.name = "StripeApiError";
  }
}

export interface StripeCreds {
  apiKey: string;
  /** Test seam / private gateways; default https://api.stripe.com. */
  apiBase?: string;
}

/** One Stripe v1 call. GET params go on the query string; writes are form-encoded. */
export async function stripeRequest<T = Record<string, unknown>>(
  creds: StripeCreds,
  method: "GET" | "POST" | "DELETE",
  path: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const base = (creds.apiBase || DEFAULT_API_BASE).replace(/\/$/, "");
  const encoded = params && Object.keys(params).length ? formEncode(params) : "";
  const url = method === "GET" && encoded ? `${base}${path}?${encoded}` : `${base}${path}`;
  const headers: Record<string, string> = {
    authorization: `Bearer ${creds.apiKey}`,
    "stripe-version": STRIPE_VERSION,
  };
  let body: string | undefined;
  if (method === "POST") {
    headers["content-type"] = "application/x-www-form-urlencoded";
    // Safe-retry seal: Stripe stores the first response under this key.
    headers["idempotency-key"] = crypto.randomUUID();
    body = encoded;
  }
  const res = await fetch(url, { method, headers, body });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error ?? {}) as { type?: string; code?: string; message?: string };
    throw new StripeApiError(res.status, err.type, err.code, err.message);
  }
  return json as T;
}

export { STRIPE_VERSION, DEFAULT_API_BASE };
