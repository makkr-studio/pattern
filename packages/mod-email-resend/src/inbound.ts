/**
 * @pattern-js/mod-email-resend — inbound: the signed webhook → ingestInbound.
 *
 * Resend signs inbound webhooks the Svix way over the RAW request bytes, so
 * the seeded route's trigger uses `bodyMode: "stream"` — a buffered
 * (JSON-parsed) body is NOT the signed content. The op collects the bytes,
 * verifies (constant-time, ±5 min window) against the account's
 * `webhookSecret`, parses the `email.received` payload (attachments arrive
 * base64-inline) and hands it to mod-email's ingestInbound — which stores
 * blobs and fires the `email.inbound` events the trigger op subscribes to.
 */

import { Buffer } from "node:buffer";
import { httpOutcome, stream, value, z, type OpDefinition, type Workflow } from "@pattern-js/core";
import { EMAIL_SERVICE, verifySvix, type EmailService, type InboundInput } from "@pattern-js/mod-email";

/** Resend's `email.received` payload (defensively typed — fields we read). */
interface ResendInboundPayload {
  type?: string;
  data?: {
    from?: string | { email?: string; name?: string };
    to?: string | string[];
    cc?: string | string[];
    subject?: string;
    text?: string;
    html?: string;
    headers?: Record<string, string> | Array<{ name: string; value: string }>;
    message_id?: string;
    email_id?: string;
    attachments?: Array<{ filename?: string; content_type?: string; content?: string }>;
    created_at?: string;
  };
}

const addr = (v: string | { email?: string; name?: string } | undefined): string =>
  typeof v === "string" ? v : (v?.email ?? "");

/* ── redelivery dedup (0.5) ───────────────────────────────────────────────
 * Svix redelivers on non-2xx and timeouts with the SAME `svix-id`. One docs
 * row per svix-id carries a delivery STATE — `processing` → `processed` |
 * `failed` — mirroring mod-billing's webhook heart: a redelivery of a
 * processed event is a duplicate (acknowledged, never re-ingested), a
 * redelivery of a FAILED one is the retry svix exists for, and a concurrent
 * one is refused (409) rather than acknowledged — a row merely marked "seen"
 * before ingesting would turn a crash mid-ingest into a permanently lost
 * email. mod-store is duck-typed, never imported: without it, dedup degrades
 * gracefully to the 0.4 at-least-once behavior. */

const EVENTS_COLLECTION = "email.inbound.events";
/** How long a `processing` claim stands before a redelivery may take it over. */
const STALE_CLAIM_MS = 60_000;

/** The slice of mod-store's documents API the delivery row needs. */
interface DocsLike {
  docs: {
    ensureCollection(def: { name: string; indexes: string[] }): Promise<void>;
    get(collection: string, id: string): Promise<{ data: Record<string, unknown>; version: number } | null>;
    put(
      collection: string,
      id: string,
      data: Record<string, unknown>,
      expectedVersion?: number,
    ): Promise<{ version: number } | null>;
  };
}

type Claim = "own" | "duplicate" | "inflight" | "unavailable";

/**
 * Claim this delivery: `own` (ingest it, then `settleDelivery`), `duplicate`
 * (already processed), `inflight` (another delivery holds a fresh claim),
 * `unavailable` (no store / no svix-id — at-least-once, nothing to settle).
 * Take-overs of failed or stale claims CAS on the row version.
 */
async function claimDelivery(services: Record<string, unknown>, svixId: string, account: string): Promise<Claim> {
  const store = services["storeService"] as DocsLike | undefined;
  if (!store?.docs || !svixId) return "unavailable";
  await store.docs.ensureCollection({ name: EVENTS_COLLECTION, indexes: ["account", "status"] });
  const key = `resend:${svixId}`;
  const now = Date.now();
  const existing = await store.docs.get(EVENTS_COLLECTION, key);
  if (!existing) {
    const row = await store.docs.put(EVENTS_COLLECTION, key, { account, status: "processing", attempts: 1, at: now });
    return row && row.version === 1 ? "own" : "inflight";
  }
  const d = existing.data as { status?: string; attempts?: number; at?: number };
  // Rows from before states existed carry no status: processed, as they were.
  const status = d.status ?? "processed";
  if (status === "processed") return "duplicate";
  if (status === "processing" && now - (d.at ?? 0) < STALE_CLAIM_MS) return "inflight";
  const row = await store.docs.put(
    EVENTS_COLLECTION,
    key,
    { account, status: "processing", attempts: (d.attempts ?? 1) + 1, at: now },
    existing.version,
  );
  return row ? "own" : "inflight";
}

/** Record how an owned claim ended; a `failed` row is what the next redelivery retries. */
async function settleDelivery(
  services: Record<string, unknown>,
  svixId: string,
  account: string,
  status: "processed" | "failed",
  error?: unknown,
): Promise<void> {
  const store = services["storeService"] as DocsLike | undefined;
  if (!store?.docs || !svixId) return;
  const key = `resend:${svixId}`;
  const attempts = ((await store.docs.get(EVENTS_COLLECTION, key))?.data.attempts as number | undefined) ?? 1;
  await store.docs.put(EVENTS_COLLECTION, key, {
    account,
    status,
    attempts,
    at: Date.now(),
    ...(error !== undefined ? { error: error instanceof Error ? error.message : String(error) } : {}),
  });
}

const headerMap = (
  h: Record<string, string> | Array<{ name: string; value: string }> | undefined,
): Record<string, string> => {
  if (!h) return {};
  const entries = Array.isArray(h) ? h.map((x) => [x.name, x.value] as const) : Object.entries(h);
  return Object.fromEntries(entries.map(([k, v]) => [k.toLowerCase(), String(v)]));
};

async function collect(bytes: ReadableStream<Uint8Array>): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  const reader = bytes.getReader();
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    if (chunk) parts.push(chunk);
  }
  return Buffer.concat(parts);
}

export const resendWebhookOp: OpDefinition = {
  type: "email.resend.webhook",
  title: "email.resend.webhook",
  description:
    "Verify + ingest a Resend inbound-email webhook: raw body stream + headers in, svix signature checked against " +
    "the account's webhookSecret, attachments stored as blobs, email.inbound fired. Non-inbound event types are " +
    "acknowledged and ignored. Outputs { result } (an outcome on bad signatures — wire boundary.http.status).",
  reusable: false,
  config: z.object({
    /** The receiving account (its secrets carry webhookSecret). Default "default". */
    account: z.string().default("default"),
  }),
  inputs: {
    body: stream(z.instanceof(Uint8Array)),
    headers: value(z.record(z.string(), z.string())),
  },
  outputs: { result: value() },
  execute: async (ctx) => {
    const { account } = ctx.config as { account: string };
    const svc = ctx.services[EMAIL_SERVICE] as EmailService | undefined;
    if (!svc) throw new Error("email.resend.webhook: mod-email is not installed");

    const [headers, raw] = await Promise.all([
      ctx.input.value<Record<string, string>>("headers"),
      collect(ctx.input.stream<Uint8Array>("body")),
    ]);

    const secret = await svc.accountSecret(account, "webhookSecret", ctx);
    if (!secret) {
      return {
        result: httpOutcome("invalid", {
          error: "not_configured",
          message: `account "${account}" has no webhookSecret — add the whsec_… value in admin → System → Email`,
        }),
      };
    }
    const ok = verifySvix({
      secret,
      id: headers["svix-id"] ?? "",
      timestamp: headers["svix-timestamp"] ?? "",
      signature: headers["svix-signature"] ?? "",
      payload: raw,
    });
    if (!ok) return { result: httpOutcome("unauthorized", { error: "bad_signature" }) };

    let payload: ResendInboundPayload;
    try {
      payload = JSON.parse(raw.toString("utf8")) as ResendInboundPayload;
    } catch {
      return { result: httpOutcome("invalid", { error: "bad_json" }) };
    }
    // Resend sends several event families to one endpoint — ack what isn't inbound mail.
    if (payload.type && !/received/i.test(payload.type)) return { result: { ok: true, ignored: payload.type } };
    // Claim the delivery (same svix-id → duplicate / in-flight / ours).
    const services = ctx.services as unknown as Record<string, unknown>;
    const svixId = headers["svix-id"] ?? "";
    const claim = await claimDelivery(services, svixId, account);
    if (claim === "duplicate") return { result: { ok: true, duplicate: true } };
    if (claim === "inflight") {
      // Refuse, don't acknowledge: svix redelivers on a non-2xx, and the
      // in-flight attempt may yet fail.
      return { result: httpOutcome("conflict", { error: "in_flight", message: "another delivery of this event is being processed — retry shortly" }) };
    }
    const data = payload.data ?? {};
    const headersIn = headerMap(data.headers);

    const input: InboundInput = {
      account,
      from: addr(data.from),
      to: data.to ?? [],
      cc: data.cc,
      subject: data.subject,
      text: data.text,
      html: data.html,
      headers: headersIn,
      messageId: data.message_id ?? data.email_id ?? headersIn["message-id"],
      inReplyTo: headersIn["in-reply-to"],
      references: headersIn["references"]?.split(/\s+/).filter(Boolean),
      attachments: (data.attachments ?? [])
        .filter((a) => a.content)
        .map((a) => ({
          filename: a.filename,
          mime: a.content_type,
          content: new Uint8Array(Buffer.from(a.content!, "base64")),
        })),
      receivedAt: data.created_at ? Date.parse(data.created_at) || undefined : undefined,
    };
    let message: Awaited<ReturnType<EmailService["ingestInbound"]>>;
    try {
      message = await svc.ingestInbound(input, ctx);
    } catch (err) {
      // Leave a retryable record and fail the delivery — svix's redelivery
      // (or a manual resend) ingests it then.
      if (claim === "own") await settleDelivery(services, svixId, account, "failed", err);
      throw err;
    }
    if (claim === "own") await settleDelivery(services, svixId, account, "processed");
    return { result: { ok: true, messageId: message.messageId, attachments: message.attachments.length } };
  },
};

/** The seeded webhook route: POST /email/inbound/resend (raw-bytes trigger). */
export function resendInboundWorkflow(path = "/email/inbound/resend"): Workflow {
  return {
    id: "email.resend.inbound",
    name: `Email · Resend inbound webhook (POST ${path})`,
    description:
      "Point your Resend inbound webhook here. The trigger streams the RAW bytes (bodyMode: stream — the svix " +
      "signature covers them exactly); the op verifies, stores attachments as blobs, and fires email.inbound. " +
      "Fork to serve another account or path.",
    source: "code",
    nodes: [
      {
        id: "in",
        op: "boundary.http.request",
        // Signature auth IS the gate — requireAuth: false marks acknowledged-public.
        config: { method: "POST", path, bodyMode: "stream", requireAuth: false },
        ui: { x: 60, y: 120, pair: "out" },
      },
      {
        id: "hook",
        op: "email.resend.webhook",
        config: { account: "default" },
        comment: "Verify svix signature over the raw bytes → ingest → email.inbound fires.",
        ui: { x: 340, y: 120 },
      },
      { id: "status", op: "boundary.http.status", ui: { x: 620, y: 120 } },
      { id: "out", op: "boundary.http.response", ui: { x: 900, y: 120, pair: "in" } },
    ],
    edges: [
      { from: { node: "in", port: "body" }, to: { node: "hook", port: "body" } },
      { from: { node: "in", port: "headers" }, to: { node: "hook", port: "headers" } },
      { from: { node: "hook", port: "result" }, to: { node: "status", port: "result" } },
      { from: { node: "status", port: "status" }, to: { node: "out", port: "status" } },
      { from: { node: "status", port: "body" }, to: { node: "out", port: "body" } },
    ],
  };
}
