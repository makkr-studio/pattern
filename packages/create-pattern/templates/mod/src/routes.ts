import { httpEndpoint, type Workflow } from "@pattern/core";

/**
 * Routes are workflows that front a pure op — the op stays HTTP-free.
 * `httpEndpoint` emits the canonical shape (request → op → response); `io.out`
 * names the op output that becomes the body. For input routes, map a request
 * part with `io: { in: { portName: fromParams() }, out: "..." }` (also
 * `fromQuery` / `fromBody`, importable from `@pattern/core`).
 */

/** Public API route — `GET /api/{{name}}/items`. Works without the admin. */
export const itemsRoute: Workflow = httpEndpoint({
  id: "{{opPrefix}}.route.items",
  name: "{{pkgName}} · GET /api/{{name}}/items",
  method: "GET",
  path: "/api/{{name}}/items",
  op: "{{opPrefix}}.items.list",
  io: { out: "items" },
});

/** Admin-mounted route — what the admin page reads (relative to the admin API mount). */
export const itemsAdminRoute: Workflow = httpEndpoint({
  id: "{{opPrefix}}.route.items.admin",
  name: "{{pkgName}} · GET /admin/api/{{name}}/items",
  method: "GET",
  path: "/admin/api/{{name}}/items",
  op: "{{opPrefix}}.items.list",
  io: { out: "items" },
});
