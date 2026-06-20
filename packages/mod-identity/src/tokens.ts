/**
 * @pattern-js/mod-identity — secret helpers.
 *
 * Secrets are 256-bit random, base64url on the wire, sha256 at rest. Lookup
 * is by hash (an exact index hit), so no constant-time comparison is needed —
 * there is nothing secret-shaped to compare against.
 */

import { createHash, randomBytes } from "node:crypto";

/** A fresh 256-bit secret, base64url (cookie- and URL-safe). */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
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
