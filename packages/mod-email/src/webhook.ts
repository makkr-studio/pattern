/**
 * @pattern-js/mod-email — webhook signature verification (Svix scheme).
 *
 * Resend (and many others) sign inbound webhooks the Svix way:
 * `HMAC-SHA256(base64decode(secret without "whsec_"), "{id}.{timestamp}.{body}")`,
 * base64-encoded, in a space-separated multi-signature header
 * (`v1,<sig> v1,<sig2> …` — key rotation sends several). Hand-rolled on
 * node:crypto — ~30 lines beats a dependency — with constant-time comparison
 * and a ±5 minute timestamp window against replays.
 *
 * IMPORTANT for callers: verify the RAW request bytes. A JSON-parsed-and-
 * re-stringified body is NOT the signed content — webhook routes must use
 * `bodyMode: "stream"` on their trigger.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifySvixInput {
  /** The `whsec_…` secret (or its bare base64 tail). */
  secret: string;
  /** svix-id header. */
  id: string;
  /** svix-timestamp header (unix seconds). */
  timestamp: string;
  /** svix-signature header (space-separated `v1,<base64>` candidates). */
  signature: string;
  /** The RAW request body bytes (or their exact utf-8 string). */
  payload: Uint8Array | string;
  /** Clock skew tolerance (default 5 minutes). */
  toleranceMs?: number;
  /** Test seam. */
  now?: number;
}

/** True only for a well-formed, in-window, correctly signed webhook. */
export function verifySvix(input: VerifySvixInput): boolean {
  const { secret, id, timestamp, signature, payload } = input;
  if (!secret || !id || !timestamp || !signature) return false;

  const tsSeconds = Number(timestamp);
  if (!Number.isFinite(tsSeconds)) return false;
  const toleranceMs = input.toleranceMs ?? 5 * 60 * 1000;
  const now = input.now ?? Date.now();
  if (Math.abs(now - tsSeconds * 1000) > toleranceMs) return false;

  let key: Buffer;
  try {
    key = Buffer.from(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret, "base64");
  } catch {
    return false;
  }
  if (!key.length) return false;

  const body = typeof payload === "string" ? Buffer.from(payload, "utf8") : Buffer.from(payload);
  const signed = Buffer.concat([Buffer.from(`${id}.${tsSeconds}.`, "utf8"), body]);
  const expected = createHmac("sha256", key).update(signed).digest();

  for (const candidate of signature.split(/\s+/)) {
    const [version, sig] = candidate.split(",", 2);
    if (version !== "v1" || !sig) continue;
    let given: Buffer;
    try {
      given = Buffer.from(sig, "base64");
    } catch {
      continue;
    }
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}
