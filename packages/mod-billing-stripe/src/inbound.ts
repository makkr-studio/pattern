/**
 * @pattern-js/mod-billing-stripe — the webhook route.
 *
 * Stripe signs the RAW request bytes, so the seeded route's trigger uses
 * `bodyMode: "stream"` — a buffered (JSON-parsed) body is NOT the signed
 * content. The op collects the bytes and hands them to mod-billing's
 * `ingestEvent` (verify → dedup → map → project roles → emit); a bad
 * signature comes back as a 401 outcome, anything else 2xx so Stripe stops
 * redelivering.
 */

import { httpOutcome, stream, value, z, type OpDefinition, type Workflow } from "@pattern-js/core";
import { BILLING_SERVICE, BillingSignatureError, type BillingService } from "@pattern-js/mod-billing";

async function collect(bytes: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let total = 0;
  const reader = bytes.getReader();
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    if (chunk) {
      parts.push(chunk);
      total += chunk.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

export const stripeWebhookOp: OpDefinition = {
  type: "billing.stripe.webhook",
  title: "billing.stripe.webhook",
  description:
    "Verify + ingest a Stripe webhook: raw body stream + headers in, Stripe-Signature checked against the " +
    "account's webhookSecret, then mod-billing's pipeline (dedup on the event id, customer mapping, role " +
    "projection, billing.* events). Outputs { result } (an outcome on bad signatures — wire boundary.http.status).",
  reusable: false,
  config: z.object({
    /** The billing account (its secrets carry webhookSecret). Default "default". */
    account: z.string().default("default"),
  }),
  inputs: {
    body: stream(z.instanceof(Uint8Array)),
    headers: value(z.record(z.string(), z.string())),
  },
  outputs: { result: value() },
  execute: async (ctx) => {
    const { account } = ctx.config as { account: string };
    const svc = ctx.services[BILLING_SERVICE] as BillingService | undefined;
    if (!svc) throw new Error("billing.stripe.webhook: mod-billing is not installed");

    const [headers, raw] = await Promise.all([
      ctx.input.value<Record<string, string>>("headers"),
      collect(ctx.input.stream<Uint8Array>("body")),
    ]);

    const secret = await svc.accountSecret(account, "webhookSecret", ctx);
    if (!secret) {
      return {
        result: httpOutcome("invalid", {
          error: "not_configured",
          message: `account "${account}" has no webhookSecret — add the whsec_… value in admin → System → Billing`,
        }),
      };
    }
    try {
      const result = await svc.ingestEvent(raw, headers, account, ctx);
      return { result };
    } catch (err) {
      if (err instanceof BillingSignatureError) return { result: httpOutcome("unauthorized", { error: "bad_signature" }) };
      throw err; // a real failure → 500, so Stripe retries the delivery
    }
  },
};

/** The seeded webhook route: POST /billing/webhook/stripe (raw-bytes trigger). */
export function stripeWebhookWorkflow(path = "/billing/webhook/stripe"): Workflow {
  return {
    id: "billing.stripe.inbound",
    name: `Billing · Stripe webhook (POST ${path})`,
    description:
      "Point your Stripe webhook endpoint here (checkout.session.completed, customer.subscription.*, " +
      "invoice.paid, invoice.payment_failed). The trigger streams the RAW bytes (bodyMode: stream — the " +
      "signature covers them exactly); mod-billing verifies, dedups, maps the customer and projects the " +
      "entitlement role. Fork to serve another account or path.",
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
        op: "billing.stripe.webhook",
        config: { account: "default" },
        comment: "Verify Stripe-Signature over the raw bytes → dedup → map → project roles → billing.* events.",
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
