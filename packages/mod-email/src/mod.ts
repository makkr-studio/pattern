/**
 * @pattern-js/mod-email — mod assembly.
 *
 * The CONTRACT mod: it owns the account settings, the `email.send` /
 * `email.account` ops, the admin page, and the packaged sign-in delivery
 * workflow. It sends nothing by itself — driver mods (mod-email-resend,
 * mod-email-smtp, …) register an `EmailDriverSpec` on the service in their
 * `ready()`. Both services are provided in `setup`, so drivers can rely on
 * them regardless of listing order in pattern.config.json (two-phase install).
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { localFs, provideFilesystem } from "@pattern-js/runtime-node";
import { defineMod, type Engine, type PatternMod } from "@pattern-js/core";
import { EmailConfigService } from "./config.js";
import { DefaultEmailService } from "./service.js";
import { EMAIL_CONFIG_SERVICE, EMAIL_SERVICE } from "./well-known.js";
import { accountOp } from "./ops/account.js";
import { inboundOps } from "./ops/inbound.js";
import { sendOp } from "./ops/send.js";
import { deliverTokenWorkflow } from "./delivery.js";
import { emailAdminRoutes, emailFrontend, settingsOps } from "./settings.js";

export interface EmailModOptions {
  /** Where accounts persist. Default ".pattern-data/email-config.json". */
  configPath?: string;
}

/** The packaged docs/ chapter (the `docs` contribution points at "email-docs"). */
function packagedDocs(engine: Engine): void {
  try {
    const dir = fileURLToPath(new URL("../docs", import.meta.url));
    if (existsSync(dir)) provideFilesystem(engine, "email-docs", localFs(dir));
  } catch {
    /* packaged without docs — the contribution is simply skipped */
  }
}

export function emailMod(options: EmailModOptions = {}): PatternMod {
  const config = new EmailConfigService(options.configPath);
  const service = new DefaultEmailService(config);
  return defineMod({
    name: "@pattern-js/mod-email",
    docs: { filesystem: "email-docs", title: "Email", order: 43 },
    ops: [sendOp, accountOp, ...inboundOps, ...settingsOps],
    // The delivery workflow registers unconditionally: without mod-identity its
    // hook is auto-declared and never invoked (inert); with it, delivery starts
    // the moment a "default" account exists.
    workflows: [deliverTokenWorkflow(), ...emailAdminRoutes()],
    frontend: emailFrontend(),
    setup: (engine: Engine) => {
      packagedDocs(engine);
      engine.provideService(EMAIL_CONFIG_SERVICE, config);
      engine.provideService(EMAIL_SERVICE, service);
    },
    ready: async () => {
      await config.load();
    },
  });
}

/** Ready-to-use with defaults (for `loadMods`/`engine.use`). */
export default emailMod();
