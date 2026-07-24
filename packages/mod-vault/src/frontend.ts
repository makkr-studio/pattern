/**
 * @pattern-js/mod-vault — admin Secrets screen (Tier-2).
 *
 * A write-only surface: the table lists names and dates, the form encrypts
 * and forgets (rotation = write the same name again), and Import .env turns
 * a pasted file into encrypted secrets in one click — the vault-first
 * migration path. The component source lives in ./app.ts.
 */

import type { FrontendContribution } from "@pattern-js/core";
import { REMOTE } from "./app.js";

export function vaultFrontend(): FrontendContribution {
  return {
    menu: [
      { category: "System", label: "Secrets", icon: "key", path: "/x/vault/secrets", order: 40 },
    ],
    pages: [{ path: "/x/vault/secrets", title: "Secrets", module: REMOTE }],
    commands: [
      { id: "vault.secrets", label: "Secrets…", group: "System", icon: "key", path: "/x/vault/secrets" },
    ],
  };
}
