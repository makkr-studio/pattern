/**
 * @pattern-js/mod-billing — value shapes shared across the mod and its drivers.
 *
 * The persisted unit is an **account** — a memorable name ("default") bound to
 * a payment provider, sourced secrets, and driver options — mirroring
 * mod-email's contract exactly: two Stripe accounts with different keys are
 * just two records, and what flows on edges is the account NAME, never a
 * secret. Providers (mod-billing-stripe, mod-billing-revolut, …) register a
 * `BillingDriverSpec`; everything above the driver speaks the NORMALIZED
 * `BillingEvent` union, so a workflow built on "payment failed" survives a
 * processor swap untouched.
 */

import { z, secretRefSchema } from "@pattern-js/core";
import type { OpContext } from "@pattern-js/core";

export { secretRefSchema, type SecretRef } from "@pattern-js/core";

/* ── accounts ─────────────────────────────────────────────────────────── */

export const billingAccountSchema = z.object({
  /** "default" is the convention ops and the starter fall back to. */
  name: z.string().min(1),
  /** Driver id: "stripe", … (registered by a driver mod). */
  provider: z.string().min(1),
  /** field → where its value lives (vault secret or env var), never the value. */
  secrets: z.record(z.string(), secretRefSchema).default({}),
  /** Driver options: apiBase/defaultPriceKey/… — see each driver's fields. */
  options: z.record(z.string(), z.string()).default({}),
});
export type BillingAccount = z.infer<typeof billingAccountSchema>;

/** What flows on edges: the account NAME; secrets resolve at call time. */
export const billingAccountRefSchema = z.object({
  kind: z.literal("billingAccount"),
  account: z.string(),
  /** Display/validation only — the persisted record is the source of truth. */
  provider: z.string(),
});
export type BillingAccountRef = z.infer<typeof billingAccountRefSchema>;

/* ── subscription state ───────────────────────────────────────────────── */

/** Provider-neutral subscription statuses (the Stripe set is the superset). */
export const subscriptionStatusSchema = z.enum([
  "active",
  "trialing",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

/** The entitlement rule: active/trialing pay the bills; past_due is a policy call. */
export function isEntitled(status: SubscriptionStatus | undefined, gracePastDue: boolean): boolean {
  if (!status) return false;
  return status === "active" || status === "trialing" || (gracePastDue && status === "past_due");
}

/* ── the normalized event union (what every driver parses INTO) ───────── */

export type BillingEvent =
  | {
      kind: "checkout.completed";
      /** Provider event id (evt_…) — stable across redeliveries; the dedup key. */
      eventId: string;
      customerId?: string;
      subscriptionId?: string;
      /** Your user id, echoed back (client_reference_id / metadata). */
      userRef?: string;
      email?: string;
      metadata?: Record<string, string>;
    }
  | {
      kind: "subscription.updated";
      eventId: string;
      customerId: string;
      subscriptionId: string;
      status: SubscriptionStatus;
      /** The subscribed price identifiers (lookup keys when set, else ids). */
      priceKeys: string[];
      cancelAtPeriodEnd?: boolean;
    }
  | { kind: "subscription.deleted"; eventId: string; customerId: string; subscriptionId: string }
  | { kind: "invoice.paid"; eventId: string; customerId?: string; subscriptionId?: string }
  | { kind: "invoice.payment_failed"; eventId: string; customerId?: string; subscriptionId?: string };

export type BillingEventKind = BillingEvent["kind"];

export const BILLING_EVENT_KINDS: BillingEventKind[] = [
  "checkout.completed",
  "subscription.updated",
  "subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
];

/**
 * Thrown by a driver's `verifyAndParse` when the webhook signature is wrong or
 * missing — the webhook op maps it to a 401 outcome. Anything else the driver
 * throws is a real failure (→ 500, so the provider retries).
 */
export class BillingSignatureError extends Error {
  constructor(message = "webhook signature verification failed") {
    super(message);
    this.name = "BillingSignatureError";
  }
}

/**
 * Thrown when billing simply isn't SET UP yet — no account, no driver, a
 * missing required secret, no price to sell. The checkout/portal ops turn it
 * into a friendly 409 outcome (with a pointer at admin → System → Billing)
 * instead of a failed run: an unconfigured demo is a to-do, not an error.
 */
export class BillingNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingNotConfiguredError";
  }
}

/**
 * Thrown when the USER's billing state can't satisfy the call — e.g. opening
 * the customer portal before any subscription exists. Mapped to a friendly
 * conflict outcome ("subscribe first"), never a 500.
 */
export class BillingNoCustomerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingNoCustomerError";
  }
}

/* ── driver-facing request/response shapes ────────────────────────────── */

export interface DriverCheckoutRequest {
  /** "subscription" (default) or "payment" (one-time). */
  mode: "subscription" | "payment";
  /** The provider price identifier (price_… / a lookup key the driver resolves). */
  priceKey: string;
  quantity: number;
  successUrl: string;
  cancelUrl: string;
  /** Your user id — echoed back on checkout.completed as `userRef`. */
  userRef?: string;
  /** Prefill / customer creation hint when no customerId exists yet. */
  email?: string;
  /** Reuse an existing provider customer. */
  customerId?: string;
  /**
   * Provider-side retry seal: the same key replays the SAME session instead of
   * creating a second one (Stripe stores idempotent POSTs ≥24h). mod-billing
   * pins it to the run+node, so a per-node retry converges by construction.
   */
  idempotencyKey?: string;
}

export interface DriverPortalRequest {
  customerId: string;
  returnUrl: string;
  /** Provider-side retry seal — see DriverCheckoutRequest.idempotencyKey. */
  idempotencyKey?: string;
}

/** What `getSubscription` returns — the mapping doc's provider-fresh mirror. */
export interface ProviderSubscription {
  subscriptionId: string;
  customerId: string;
  status: SubscriptionStatus;
  priceKeys: string[];
  cancelAtPeriodEnd?: boolean;
}

export interface DriverUsageEvent {
  customerId: string;
  /** The meter's event name (created on the provider). */
  meter: string;
  value: number;
  /** Provider-side dedup key (Stripe: 24h window). */
  identifier?: string;
  /** Epoch ms; default now. */
  at?: number;
}

/**
 * A payment driver, registered by a provider mod via
 * `BillingService.registerDriver` in its `ready()`. The `secrets`/`options`
 * field lists drive the auto-generated account form in admin → System →
 * Billing (same descriptors as mod-email's drivers).
 */
export interface BillingDriverSpec {
  id: string;
  label: string;
  secrets: Array<{ field: string; label: string; required?: boolean }>;
  options: Array<{ field: string; label: string; required?: boolean; placeholder?: string }>;
  createCheckout(
    req: DriverCheckoutRequest,
    creds: Record<string, string>,
    options: Record<string, string>,
    ctx: OpContext,
  ): Promise<{ url: string; sessionId?: string }>;
  createPortal(
    req: DriverPortalRequest,
    creds: Record<string, string>,
    options: Record<string, string>,
    ctx: OpContext,
  ): Promise<{ url: string }>;
  getSubscription(
    subscriptionId: string,
    creds: Record<string, string>,
    options: Record<string, string>,
    ctx: OpContext,
  ): Promise<ProviderSubscription>;
  recordUsage(
    evt: DriverUsageEvent,
    creds: Record<string, string>,
    options: Record<string, string>,
    ctx: OpContext,
  ): Promise<void>;
  /**
   * Verify the RAW webhook bytes against the account's signing secret and
   * parse the payload into a normalized event. Return null for event types
   * the contract doesn't model (acknowledged + ignored). Throw
   * `BillingSignatureError` on a bad/missing signature — never null, so a
   * forged request can't masquerade as ignorable.
   */
  verifyAndParse(
    raw: Uint8Array,
    headers: Record<string, string>,
    creds: Record<string, string>,
    options: Record<string, string>,
    ctx: OpContext,
  ): Promise<BillingEvent | null>;
}

/** The serializable driver catalog (what `billing.providers.list` returns). */
export type BillingDriverInfo = Omit<
  BillingDriverSpec,
  "createCheckout" | "createPortal" | "getSubscription" | "recordUsage" | "verifyAndParse"
>;

/* ── the customer mapping (billing.customers docs collection) ─────────── */

/** The user ↔ provider-customer bridge, updated by every webhook. */
export interface BillingCustomer {
  userId?: string;
  customerId: string;
  provider: string;
  account: string;
  email?: string;
  subscriptionId?: string;
  status?: SubscriptionStatus;
  priceKeys?: string[];
  entitled: boolean;
  updatedAt: number;
}
