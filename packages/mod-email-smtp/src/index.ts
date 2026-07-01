/**
 * @pattern-js/mod-email-smtp — SMTP driver for mod-email.
 *
 * All the sending logic lives in driver.ts; this mod just registers it on
 * mod-email's service in `ready` (after every setup ran — two-phase install,
 * so listing order in pattern.config.json doesn't matter). Host/port/user are
 * account options in admin → System → Email; the password comes from the
 * vault or an env var.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { localFs, provideFilesystem } from "@pattern-js/runtime-node";
import { defineMod, type Engine, type PatternMod } from "@pattern-js/core";
import { EMAIL_SERVICE, type EmailService } from "@pattern-js/mod-email";
import { smtpDriver, type SmtpTransportConfig, type TransportFactory } from "./driver.js";

export { smtpDriver, type SmtpTransportConfig, type TransportFactory } from "./driver.js";

export interface SmtpEmailModOptions {
  /** Override how transports are built (the test seam; default nodemailer.createTransport). */
  transportFactory?: TransportFactory;
}

/** The packaged docs/ chapter (the `docs` contribution points at "email-smtp-docs"). */
function packagedDocs(engine: Engine): void {
  try {
    const dir = fileURLToPath(new URL("../docs", import.meta.url));
    if (existsSync(dir)) provideFilesystem(engine, "email-smtp-docs", localFs(dir));
  } catch {
    /* packaged without docs — the contribution is simply skipped */
  }
}

export function smtpEmailMod(options: SmtpEmailModOptions = {}): PatternMod {
  return defineMod({
    name: "@pattern-js/mod-email-smtp",
    docs: { filesystem: "email-smtp-docs", title: "Email · SMTP", order: 45 },
    // `ready`, not `setup`: mod-email provides its service in setup, and every
    // setup runs before any ready — order in the config is free.
    ready: (engine: Engine) => {
      packagedDocs(engine);
      const svc = engine.service<EmailService>(EMAIL_SERVICE);
      if (!svc) {
        console.error(
          "[pattern] @pattern-js/mod-email-smtp: email service not found — add @pattern-js/mod-email to your mods.",
        );
        return;
      }
      svc.registerDriver(smtpDriver(options.transportFactory));
    },
  });
}

/** Ready-to-use with defaults (for `loadMods`/`engine.use`). */
export default smtpEmailMod();
