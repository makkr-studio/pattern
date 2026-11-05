/**
 * @pattern-js/mod-billing — mod assembly.
 *
 * The CONTRACT mod: it owns the account settings, the billing ops + trigger,
 * and the admin page. It charges nothing by itself — driver mods
 * (mod-billing-stripe, …) register a `BillingDriverSpec` on the service in
 * their `ready()`. Both services are provided in `setup`, so drivers can rely
 * on them regardless of listing order (two-phase install). The docs
 * collections (events dedup + customer mapping) are ensured lazily on first
 * use, so a store-less app still checks out and emits.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { localFs, provideFilesystem } from "@pattern-js/runtime-node";
import { defineMod, type Engine, type PatternMod } from "@pattern-js/core";
import { BillingConfigService } from "./config.js";
import { DefaultBillingService, type BillingModOptions } from "./service.js";
import { BILLING_CONFIG_SERVICE, BILLING_SERVICE } from "./well-known.js";
import { billingOps } from "./ops.js";
import { adminOps, billingAdminRoutes, billingFrontend } from "./admin.js";
import { billingPageWorkflows, pageOps } from "./pages.js";
import { meterAiUsageWorkflow } from "./metering.js";

/** The packaged docs/ chapter (the `docs` contribution points at "billing-docs"). */
function packagedDocs(engine: Engine): void {
  try {
    const dir = fileURLToPath(new URL("../docs", import.meta.url));
    if (existsSync(dir)) provideFilesystem(engine, "billing-docs", localFs(dir));
  } catch {
    /* packaged without docs — the contribution is simply skipped */
  }
}

export function billingMod(options: BillingModOptions = {}): PatternMod {
  const config = new BillingConfigService(options.configPath);
  const service = new DefaultBillingService(config, options);
  // The checkout return pages (+ the poller the success page uses). Where
  // checkout REDIRECTS and what SERVES those paths stay one decision.
  const pagePaths = {
    success: options.successPath ?? "/billing/success",
    cancel: options.cancelPath ?? "/billing/cancel",
    status: options.statusPath ?? "/billing/status",
  };
  return defineMod({
    name: "@pattern-js/mod-billing",
    docs: { filesystem: "billing-docs", title: "Billing", order: 46 },
    ops: [...billingOps, ...adminOps, ...pageOps],
    // One flag turns on the usage-billing loop: mod-ai's ai.usage events →
    // provider meter events, as an editable workflow (metering is an edge).
    workflows: [
      ...billingAdminRoutes(),
      ...(options.pages === false ? [] : billingPageWorkflows(pagePaths)),
      ...(options.meterAiUsage ? [meterAiUsageWorkflow(options.aiMeter ?? "ai_tokens")] : []),
    ],
    frontend: billingFrontend(),
    setup: (engine: Engine) => {
      packagedDocs(engine);
      engine.provideService(BILLING_CONFIG_SERVICE, config);
      engine.provideService(BILLING_SERVICE, service);
    },
    ready: async () => {
      await config.load();
    },
  });
}

/** Ready-to-use with defaults (for `loadMods`/`engine.use`). */
export default billingMod();
