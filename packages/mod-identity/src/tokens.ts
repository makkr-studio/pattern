/**
 * @pattern-js/mod-identity — secret helpers.
 *
 * Secrets are 256-bit random, base64url on the wire, sha256 at rest. Lookup
 * is by hash (an exact index hit), so no constant-time comparison is needed —
 * there is nothing secret-shaped to compare against. The one exception is the
 * short sign-in code: too little entropy for hash lookup, so the service scans
 * the email's pending rows and compares hashes in constant time.
 */

import { createHash, randomBytes, randomInt } from "node:crypto";

/** A fresh 256-bit secret, base64url (cookie- and URL-safe). */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * A fresh 6-digit sign-in code, uniform over 000000–999999. Low entropy by
 * design (it exists to be typed from an email into a PWA) — its safety comes
 * from the token's TTL, single-use CAS, and the wrong-guess budget.
 */
export function randomCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** "482 913" → "482913" — accept whatever spacing the email copy or autofill added. */
export function normalizeCode(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** "482913" → "482 913" — the display form used in email copy and the console. */
export function formatCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** sha256 hex — the only form a secret takes in storage. */
export function sha256hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Normalize an email for identity purposes. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Loose-but-useful email shape check (real validation is the delivery). */
export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
