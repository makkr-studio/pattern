/**
 * @pattern-js/mod-email — value shapes shared across the mod and its drivers.
 *
 * The persisted unit is an **account** — a memorable name ("default") bound to
 * a driver id, a From address, sourced secrets, and driver options. Two
 * accounts of the same provider with different credentials are just two
 * records. What flows on edges is an `EmailAccountRef` (the NAME, never the
 * secrets) — re-pointing an account in admin re-targets every workflow.
 */

import { z, secretRefSchema } from "@pattern-js/core";
import type { OpContext } from "@pattern-js/core";

/* ── sourced secrets (hoisted to core; re-exported for drivers) ─────────── */

export { secretRefSchema, type SecretRef } from "@pattern-js/core";

/* ── accounts ─────────────────────────────────────────────────────────── */

export const accountSchema = z.object({
  /** "default" is the convention the delivery workflow and agents fall back to. */
  name: z.string().min(1),
  /** Driver id: "resend", "smtp", … (registered by a driver mod). */
  provider: z.string().min(1),
  /** Default From — `App <hello@example.com>` (the email analog of modelId). */
  from: z.string().min(1),
  /** field → where its value lives (vault secret or env var), never the value. */
  secrets: z.record(z.string(), secretRefSchema).default({}),
  /** Driver options: host/port/baseUrl/… — see each driver's declared fields. */
  options: z.record(z.string(), z.string()).default({}),
});
export type EmailAccount = z.infer<typeof accountSchema>;

/** What flows on edges: the account NAME; secrets resolve at send time. */
export const accountRefSchema = z.object({
  kind: z.literal("emailAccount"),
  account: z.string(),
  /** Display/validation only — the persisted record is the source of truth. */
  provider: z.string(),
});
export type EmailAccountRef = z.infer<typeof accountRefSchema>;

/* ── attachments (the three accepted input shapes) ────────────────────── */

const bytesSchema = z.custom<Uint8Array>((v) => v instanceof Uint8Array);

/** In-memory media, the shape mod-ai's generation ops output. */
export const mediaAttachmentSchema = z.object({
  bytes: bytesSchema,
  mime: z.string(),
  kind: z.string().optional(),
  filename: z.string().optional(),
});

/** A pointer into the blob store (mod-store), the shape `store.blob.put` returns. */
export const mediaRefAttachmentSchema = z.object({
  blobId: z.string(),
  mime: z.string().optional(),
  filename: z.string().optional(),
});

/** A literal file: string content is UTF-8 text. */
export const literalAttachmentSchema = z.object({
  filename: z.string(),
  content: z.union([z.string(), bytesSchema]),
  mime: z.string().optional(),
});

export const attachmentInputSchema = z.union([
  mediaRefAttachmentSchema,
  mediaAttachmentSchema,
  literalAttachmentSchema,
]);
export type AttachmentInput = z.infer<typeof attachmentInputSchema>;

/** What drivers receive: every attachment resolved to named bytes. */
export interface EmailAttachment {
  filename: string;
  content: Uint8Array;
  mime: string;
}

/* ── the normalized message + the driver contract ─────────────────────── */

/** The message a driver's `send` receives — recipients listed, bodies final. */
export interface EmailMessage {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: EmailAttachment[];
}

/**
 * A driver, registered by a provider mod (`mod-email-resend`, `mod-email-smtp`,
 * …) via `EmailService.registerDriver` in its `ready()`. The `secrets`/`options`
 * field lists drive the auto-generated account form in admin → System → Email.
 * (Field descriptors use `field` for the key — this mod's admin page is new
 * code, so it doesn't inherit mod-ai's `name` naming for the same idea.)
 */
export interface EmailDriverSpec {
  id: string;
  label: string;
  secrets: Array<{ field: string; label: string; required?: boolean }>;
  options: Array<{ field: string; label: string; required?: boolean; placeholder?: string }>;
  send(
    message: EmailMessage,
    creds: Record<string, string>,
    options: Record<string, string>,
    ctx: OpContext,
  ): Promise<{ messageId?: string }>;
}

/** The serializable driver catalog (what `email.providers.list` returns). */
export type EmailDriverInfo = Omit<EmailDriverSpec, "send">;

/* ── the op-facing send input (pre-normalization) ─────────────────────── */

export interface SendInput {
  account?: EmailAccountRef | string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  from?: string;
  subject: string;
  markdown?: string;
  html?: string;
  text?: string;
  attachments?: AttachmentInput[];
}
