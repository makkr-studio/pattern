/**
 * @pattern-js/mod-billing-stripe — the driver.
 *
 * Checkout Sessions, the Customer Portal, subscription reads and Billing
 * Meter events over the zero-dep client; webhooks verified with Stripe's own
 * scheme and mapped into mod-billing's normalized event union. The portal
 * needs a CONFIGURATION to exist — first call looks one up (or creates a
 * minimal one) and caches the answer per API key, so it heals fresh accounts
 * without persisting anything.
 */

import { BillingSignatureError, type BillingDriverSpec, type BillingEvent, type SubscriptionStatus } from "@pattern-js/mod-billing";
import { stripeRequest, type StripeCreds } from "./client.js";
import { verifyStripeSignature } from "./webhook.js";

const credsOf = (creds: Record<string, string>, options: Record<string, string>): StripeCreds => ({
  apiKey: creds.apiKey ?? "",
  apiBase: options.apiBase,
});

/* ── portal configuration (looked up / created once per key) ──────────── */

const portalReady = new Map<string, Promise<void>>();

function ensurePortalConfiguration(creds: StripeCreds): Promise<void> {
  const cacheKey = `${creds.apiBase ?? ""}:${creds.apiKey.slice(-8)}`;
  let ready = portalReady.get(cacheKey);
  if (!ready) {
    ready = (async () => {
      const list = await stripeRequest<{ data: Array<{ id: string }> }>(creds, "GET", "/v1/billing_portal/configurations", {
        limit: 1,
        active: true,
      });
      if (list.data?.length) return;
      // A minimal self-serve configuration: manage payment methods, see
      // invoices, cancel. Product/price switching is a dashboard decision.
      await stripeRequest(creds, "POST", "/v1/billing_portal/configurations", {
        features: {
          payment_method_update: { enabled: true },
          invoice_history: { enabled: true },
          subscription_cancel: { enabled: true, mode: "at_period_end" },
        },
      });
    })();
    portalReady.set(cacheKey, ready);
    // A failure must not poison the cache — retry on the next call.
    ready.catch(() => portalReady.delete(cacheKey));
  }
  return ready;
}

/* ── subscription mapping ─────────────────────────────────────────────── */

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end?: boolean;
  items?: { data?: Array<{ price?: { id?: string; lookup_key?: string | null } }> };
}

const KNOWN_STATUSES: SubscriptionStatus[] = [
  "active",
  "trialing",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
];

const statusOf = (raw: string | undefined): SubscriptionStatus =>
  KNOWN_STATUSES.includes(raw as SubscriptionStatus) ? (raw as SubscriptionStatus) : "canceled";

const priceKeysOf = (sub: StripeSubscription): string[] =>
  (sub.items?.data ?? [])
    .map((i) => i.price?.lookup_key || i.price?.id)
    .filter((k): k is string => Boolean(k));

/* ── the driver ───────────────────────────────────────────────────────── */

export const stripeBillingDriver: BillingDriverSpec = {
  id: "stripe",
  label: "Stripe",
  secrets: [
    { field: "apiKey", label: "Secret key (sk_…)", required: true },
    { field: "webhookSecret", label: "Webhook signing secret (whsec_…)", required: false },
  ],
  options: [
    { field: "defaultPriceKey", label: "Default price (price_…)", required: false },
    { field: "apiBase", label: "API base URL", required: false, placeholder: "https://api.stripe.com" },
  ],

  async createCheckout(req, creds, options) {
    const session = await stripeRequest<{ id: string; url: string }>(credsOf(creds, options), "POST", "/v1/checkout/sessions", {
      mode: req.mode,
      line_items: [{ price: req.priceKey, quantity: req.quantity }],
      success_url: `${req.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: req.cancelUrl,
      ...(req.userRef ? { client_reference_id: req.userRef } : {}),
      ...(req.customerId ? { customer: req.customerId } : req.email ? { customer_email: req.email } : {}),
    }, { idempotencyKey: req.idempotencyKey });
    return { url: session.url, sessionId: session.id };
  },

  async createPortal(req, creds, options) {
    const c = credsOf(creds, options);
    await ensurePortalConfiguration(c);
    const session = await stripeRequest<{ url: string }>(c, "POST", "/v1/billing_portal/sessions", {
      customer: req.customerId,
      return_url: req.returnUrl,
    }, { idempotencyKey: req.idempotencyKey });
    return { url: session.url };
  },

  async getSubscription(subscriptionId, creds, options) {
    const sub = await stripeRequest<StripeSubscription>(credsOf(creds, options), "GET", `/v1/subscriptions/${subscriptionId}`);
    return {
      subscriptionId: sub.id,
      customerId: sub.customer,
      status: statusOf(sub.status),
      priceKeys: priceKeysOf(sub),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    };
  },

  async recordUsage(evt, creds, options) {
    await stripeRequest(credsOf(creds, options), "POST", "/v1/billing/meter_events", {
      event_name: evt.meter,
      payload: { stripe_customer_id: evt.customerId, value: evt.value },
      ...(evt.identifier ? { identifier: evt.identifier } : {}),
      ...(evt.at ? { timestamp: Math.floor(evt.at / 1000) } : {}),
    });
  },

  async verifyAndParse(raw, headers, creds) {
    const secret = creds.webhookSecret;
    if (!secret) throw new BillingSignatureError("no webhookSecret configured for this account");
    const ok = verifyStripeSignature({ secret, header: headers["stripe-signature"] ?? "", payload: raw });
    if (!ok) throw new BillingSignatureError();

    let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
    try {
      event = JSON.parse(Buffer.from(raw).toString("utf8")) as typeof event;
    } catch {
      throw new BillingSignatureError("signed payload is not JSON");
    }
    const eventId = event.id ?? "";
    const obj = event.data?.object ?? {};
    const str = (k: string): string | undefined => (typeof obj[k] === "string" ? (obj[k] as string) : undefined);

    switch (event.type) {
      case "checkout.session.completed": {
        // Delayed payment methods complete later — the async_payment /
        // subscription events carry the truth; an unpaid session is ignorable.
        if (str("payment_status") === "unpaid") return null;
        const details = obj.customer_details as { email?: string } | undefined;
        return {
          kind: "checkout.completed",
          eventId,
          customerId: str("customer"),
          subscriptionId: str("subscription"),
          userRef: str("client_reference_id"),
          email: details?.email,
          metadata: (obj.metadata as Record<string, string> | undefined) ?? undefined,
        } satisfies BillingEvent;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = obj as unknown as StripeSubscription;
        return {
          kind: "subscription.updated",
          eventId,
          customerId: sub.customer,
          subscriptionId: sub.id,
          status: statusOf(sub.status),
          priceKeys: priceKeysOf(sub),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        } satisfies BillingEvent;
      }
      case "customer.subscription.deleted": {
        const sub = obj as unknown as StripeSubscription;
        return { kind: "subscription.deleted", eventId, customerId: sub.customer, subscriptionId: sub.id } satisfies BillingEvent;
      }
      case "invoice.paid":
        return { kind: "invoice.paid", eventId, customerId: str("customer"), subscriptionId: str("subscription") } satisfies BillingEvent;
      case "invoice.payment_failed":
        return {
          kind: "invoice.payment_failed",
          eventId,
          customerId: str("customer"),
          subscriptionId: str("subscription"),
        } satisfies BillingEvent;
      default:
        // Verified but not modeled — acknowledged and ignored.
        return null;
    }
  },
};

/** Test seam: forget the portal-configuration cache (per-process). */
export function resetPortalCache(): void {
  portalReady.clear();
}
