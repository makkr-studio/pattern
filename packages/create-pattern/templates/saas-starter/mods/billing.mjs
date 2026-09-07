/**
 * Billing, app-configured (docs: /docs → “Billing”).
 *
 * Two ways to get paid, one gate. RECURRING: an active (or trialing)
 * subscription grants the identity role “member” while it stays paid.
 * ONE-TIME: a price bought outright grants its role for good. Identity’s
 * roles→scopes map (mods/identity.mjs) turns “member” into the “pro” scope —
 * so a paid feature is just `requireAuth: { scopes: ["pro"] }` on a route,
 * whether the customer subscribed or bought. Cancel in the customer portal and
 * the subscription’s role goes away on the next webhook; a purchase never does.
 *
 * Price keys are Stripe LOOKUP KEYS (Product catalog → the price → lookup key):
 * “pro” for the recurring price, “lifetime” for the one-time price. Never
 * paste price_… ids here — keys survive test → live.
 */
import { billingMod } from "@pattern-js/mod-billing";

export default billingMod({
  // Recurring: any entitled subscription → this role (workflows/checkout.json).
  entitlement: { role: "member" },
  // Keep access while the provider retries a failing renewal:
  // entitlement: { role: "member", gracePastDue: true },

  // One-time (and per-plan): price key → role. A bought price grants for good;
  // a subscribed price grants while entitled. workflows/buy.json sells "lifetime".
  grants: { lifetime: "member" },
  // Tiers: give each plan its own role, map roles → scopes in mods/identity.mjs.
  // grants: { lifetime: "member", team: "team" },

  // Usage-based billing (needs mod-ai): every model call’s tokens flow to a
  // provider meter — an editable workflow, not code.
  // meterAiUsage: true,
  // aiMeter: "ai_tokens",
});
