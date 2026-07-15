/**
 * Billing, app-configured (docs: /docs → “Billing”).
 *
 * The entitlement bridge is the whole trick: an active (or trialing)
 * subscription grants the identity role “member”; identity’s roles→scopes map
 * (mods/identity.mjs) turns that into the “pro” scope — so a paid feature is
 * just `requireAuth: { scopes: ["pro"] }` on a route. Cancel in the customer
 * portal and the role goes away on the next webhook.
 */
import { billingMod } from "@pattern-js/mod-billing";

export default billingMod({
  entitlement: { role: "member" },
  // Keep access while the provider retries a failing renewal:
  // entitlement: { role: "member", gracePastDue: true },

  // Usage-based billing (needs mod-ai): every model call’s tokens flow to a
  // provider meter — an editable workflow, not code.
  // meterAiUsage: true,
  // aiMeter: "ai_tokens",
});
