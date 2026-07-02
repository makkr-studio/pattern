/**
 * @pattern-js/mod-email-resend — Resend driver for mod-email.
 *
 * All the sending logic lives in driver.ts; this mod just registers it on
 * mod-email's service in `ready` (after every setup ran — two-phase install,
 * so listing order in pattern.config.json doesn't matter). Accounts are
 * configured in admin → System → Email; the API key comes from the vault or
 * an env var.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { localFs, provideFilesystem } from "@pattern-js/runtime-node";
import { defineMod, type Engine, type PatternMod } from "@pattern-js/core";
import { EMAIL_SERVICE, type EmailService } from "@pattern-js/mod-email";
import { resendDriver } from "./driver.js";

export { resendDriver } from "./driver.js";

/** The packaged docs/ chapter (the `docs` contribution points at "email-resend-docs"). */
function packagedDocs(engine: Engine): void {
  try {
    const dir = fileURLToPath(new URL("../docs", import.meta.url));
    if (existsSync(dir)) provideFilesystem(engine, "email-resend-docs", localFs(dir));
  } catch {
    /* packaged without docs — the contribution is simply skipped */
  }
}

export function resendEmailMod(): PatternMod {
  return defineMod({
    name: "@pattern-js/mod-email-resend",
    docs: { filesystem: "email-resend-docs", title: "Email · Resend", order: 44 },
    // `ready`, not `setup`: mod-email provides its service in setup, and every
    // setup runs before any ready — order in the config is free.
    ready: (engine: Engine) => {
      packagedDocs(engine);
      const svc = engine.service<EmailService>(EMAIL_SERVICE);
      if (!svc) {
        console.error(
          "[pattern] @pattern-js/mod-email-resend: email service not found — add @pattern-js/mod-email to your mods.",
        );
        return;
      }
      svc.registerDriver(resendDriver);
    },
  });
}

/** Ready-to-use (for `loadMods`/`engine.use`). */
export default resendEmailMod();
