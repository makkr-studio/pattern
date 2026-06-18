/**
 * @pattern/mod-vault — admin Secrets screen (Tier-1 declarative).
 *
 * A write-only surface: the table lists names and dates, the form encrypts
 * and forgets. Rotation = write the same name again.
 */

import type { FrontendContribution } from "@pattern/core";
import { PATHS } from "./admin-routes.js";

export function vaultFrontend(): FrontendContribution {
  return {
    menu: [
      { category: "System", label: "Secrets", icon: "key", path: "/x/vault/secrets", order: 40 },
    ],
    pages: [
      {
        path: "/x/vault/secrets",
        views: [
          {
            title: "Secrets",
            view: {
              kind: "table",
              route: { method: "GET", path: PATHS.secrets },
              columns: [
                { key: "name", label: "Name" },
                { key: "version", label: "v" },
                { key: "created", label: "Created", format: "date" },
                { key: "updated", label: "Rotated", format: "date" },
              ],
              rowActions: [
                { label: "Delete", route: { method: "DELETE", path: PATHS.secret }, args: { name: "name" }, icon: "trash-2", confirm: true },
              ],
            },
          },
          {
            title: "Add or rotate a secret",
            view: {
              kind: "form",
              schema: {
                type: "object",
                properties: {
                  name: { type: "string", description: 'e.g. "OPENAI_API_KEY" — how vault.read finds it' },
                  value: {
                    type: "string",
                    description: "Encrypted at rest; never displayed again. Same name = rotate.",
                  },
                },
                required: ["name", "value"],
              },
              route: { method: "POST", path: PATHS.secrets },
            },
          },
        ],
      },
    ],
    commands: [
      { id: "vault.secrets", label: "Secrets…", group: "System", icon: "key", path: "/x/vault/secrets" },
    ],
  };
}
