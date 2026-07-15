/**
 * @pattern-js/mod-billing-stripe — Stripe driver for mod-billing.
 *
 * The checkout/portal/subscription/meter logic lives in driver.ts over a
 * zero-dependency fetch client; this mod registers it on mod-billing's
 * service in `ready` (after every setup ran — two-phase install, so listing
 * order in pattern.config.json doesn't matter) and seeds the signed webhook
 * route. Accounts are configured in admin → System → Billing; the secret key
 * comes from the vault or an env var.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { localFs, provideFilesystem } from "@pattern-js/runtime-node";
import { defineMod, type Engine, type PatternMod } from "@pattern-js/core";
import { BILLING_SERVICE, type BillingService } from "@pattern-js/mod-billing";
import { stripeBillingDriver } from "./driver.js";
import { stripeWebhookOp, stripeWebhookWorkflow } from "./inbound.js";

export { stripeBillingDriver, resetPortalCache } from "./driver.js";
export { stripeWebhookOp, stripeWebhookWorkflow } from "./inbound.js";
export { formEncode, stripeRequest, StripeApiError, STRIPE_VERSION, type StripeCreds } from "./client.js";
export { verifyStripeSignature, type VerifyStripeInput } from "./webhook.js";

/** The packaged docs/ chapter. */
function packagedDocs(engine: Engine): void {
  try {
    const dir = fileURLToPath(new URL("../docs", import.meta.url));
    if (existsSync(dir)) provideFilesystem(engine, "billing-stripe-docs", localFs(dir));
  } catch {
    /* packaged without docs — the contribution is simply skipped */
  }
}

export function stripeBillingMod(): PatternMod {
  return defineMod({
    name: "@pattern-js/mod-billing-stripe",
    docs: { filesystem: "billing-stripe-docs", title: "Billing · Stripe", order: 47 },
    ops: [stripeWebhookOp],
    workflows: [stripeWebhookWorkflow()],
    // `ready`, not `setup`: mod-billing provides its service in setup, and
    // every setup runs before any ready — order in the config is free.
    ready: (engine: Engine) => {
      packagedDocs(engine);
      const svc = engine.service<BillingService>(BILLING_SERVICE);
      if (!svc) {
        console.error(
          "[pattern] @pattern-js/mod-billing-stripe: billing service not found — add @pattern-js/mod-billing to your mods.",
        );
        return;
      }
      svc.registerDriver(stripeBillingDriver);
    },
  });
}

/** Ready-to-use (for `loadMods`/`engine.use`). */
export default stripeBillingMod();
