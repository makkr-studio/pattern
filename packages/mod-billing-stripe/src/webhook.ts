/**
 * @pattern-js/mod-billing-stripe — Stripe webhook signature verification.
 *
 * Deliberately NOT the svix routine mod-email hand-rolled for Resend — the
 * two schemes look like cousins and differ in every load-bearing detail.
 * Stripe signs `${t}.${rawBody}` (two parts, no message id), uses the
 * `whsec_…` value **verbatim as the UTF-8 HMAC key — prefix included, never
 * base64-decoded** — and emits HEX signatures. The `Stripe-Signature` header
 * carries `t=<unix seconds>` plus one or more `v1=<hex>` entries (several
 * during a secret rotation — accept if ANY matches); `v0=` is a test-only
 * scheme and accepting it would be a downgrade attack. Verify over the exact
 * raw bytes: a JSON-parsed-then-restringified body is not the signed content.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifyStripeInput {
  /** The endpoint's whsec_… signing secret, used verbatim. */
  secret: string;
  /** The Stripe-Signature header value. */
  header: string;
  /** The EXACT raw request bytes. */
  payload: Uint8Array;
  /** Max clock skew in seconds (Stripe's default: 300). */
  toleranceSec?: number;
  /** Injectable clock for tests (epoch ms). */
  now?: number;
}

export function verifyStripeSignature({ secret, header, payload, toleranceSec = 300, now }: VerifyStripeInput): boolean {
  if (!secret || !header) return false;
  let t = "";
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") t = value;
    else if (key === "v1") v1.push(value); // v0 deliberately ignored
  }
  if (!t || v1.length === 0) return false;

  const ts = Number(t);
  if (!Number.isFinite(ts)) return false;
  const skew = Math.abs((now ?? Date.now()) / 1000 - ts);
  if (skew > toleranceSec) return false;

  const signed = Buffer.concat([Buffer.from(`${t}.`, "utf8"), payload]);
  const expected = createHmac("sha256", secret).update(signed).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  return v1.some((sig) => {
    const buf = Buffer.from(sig, "utf8");
    return buf.length === expectedBuf.length && timingSafeEqual(buf, expectedBuf);
  });
}
