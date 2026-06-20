/**
 * @pattern-js/mod-vault — the Secrets screen's dedicated routes.
 *
 * One purposeful route per thing the screen exposes (list / write / delete) —
 * no generic op invoker. Each is a normal workflow (request → extract →
 * vault.admin.* op → status → response) built by the shared `httpEndpoint`,
 * admin-scope-gated at the boundary (the op also re-checks `admin` in-op).
 * Paths are single-sourced here so the workflows and the manifest can't drift.
 */

import { fromBody, fromParams, httpEndpoint, type Workflow } from "@pattern-js/core";

const API = "/admin/api";

/** Route paths relative to the admin API mount — the manifest's `RouteRef.path`. */
export const PATHS = {
  /** GET (list) and POST (write/rotate) share the collection path. */
  secrets: "/vault/secrets",
  secret: "/vault/secrets/:name",
} as const;

/** The route workflows that back the Secrets screen (admin-scope gated). */
export function vaultAdminRoutes(): Workflow[] {
  const auth = { scopes: ["admin"] };
  return [
    httpEndpoint({
      id: "vault.route.admin.list",
      name: `Vault · GET ${API}${PATHS.secrets}`,
      method: "GET",
      path: `${API}${PATHS.secrets}`,
      op: "vault.admin.list",
      io: { out: "secrets" },
      auth,
    }),
    httpEndpoint({
      id: "vault.route.admin.write",
      name: `Vault · POST ${API}${PATHS.secrets}`,
      method: "POST",
      path: `${API}${PATHS.secrets}`,
      op: "vault.admin.write",
      io: { in: { name: fromBody(), value: fromBody() }, out: "result" },
      auth,
    }),
    httpEndpoint({
      id: "vault.route.admin.delete",
      name: `Vault · DELETE ${API}${PATHS.secret}`,
      method: "DELETE",
      path: `${API}${PATHS.secret}`,
      op: "vault.admin.delete",
      io: { in: { name: fromParams() }, out: "result" },
      auth,
    }),
  ];
}
