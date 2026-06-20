/**
 * @pattern-js/mod-store — the admin Data browser's dedicated routes.
 *
 * One purposeful route per thing the browser exposes — no generic op invoker.
 * Each is a normal workflow (request → extract → store.admin.* op → status →
 * response) built by the shared `httpEndpoint`, admin-scope-gated at the
 * boundary (the op also re-checks `admin` in-op, defense in depth). The paths
 * are single-sourced here so the workflows and the frontend manifest can't
 * drift: `PATHS.*` are relative to the admin API mount (what the manifest's
 * `RouteRef` carries); the workflows mount them under `${API}`.
 */

import { fromParams, httpEndpoint, type Workflow } from "@pattern-js/core";

/** The admin API mount the browser's client targets. */
const API = "/admin/api";

/** Route paths relative to the admin API mount — the manifest's `RouteRef.path`. */
export const PATHS = {
  collections: "/store/collections",
  docs: "/store/collections/:collection/docs",
  doc: "/store/collections/:collection/docs/:id",
  blobs: "/store/blobs",
  blob: "/store/blobs/:id",
} as const;

/** The route workflows that back the Data browser (admin-scope gated). */
export function storeAdminRoutes(): Workflow[] {
  const auth = { scopes: ["admin"] };
  return [
    httpEndpoint({
      id: "store.route.admin.collections",
      name: `Store · GET ${API}${PATHS.collections}`,
      method: "GET",
      path: `${API}${PATHS.collections}`,
      op: "store.admin.collections",
      io: { out: "collections" },
      auth,
    }),
    httpEndpoint({
      id: "store.route.admin.docs",
      name: `Store · GET ${API}${PATHS.docs}`,
      method: "GET",
      path: `${API}${PATHS.docs}`,
      op: "store.admin.docs",
      io: { in: { collection: fromParams() }, out: "documents" },
      auth,
    }),
    httpEndpoint({
      id: "store.route.admin.doc.get",
      name: `Store · GET ${API}${PATHS.doc}`,
      method: "GET",
      path: `${API}${PATHS.doc}`,
      op: "store.admin.doc.get",
      io: { in: { collection: fromParams(), id: fromParams() }, out: "document" },
      auth,
    }),
    httpEndpoint({
      id: "store.route.admin.blobs",
      name: `Store · GET ${API}${PATHS.blobs}`,
      method: "GET",
      path: `${API}${PATHS.blobs}`,
      op: "store.admin.blobs",
      io: { out: "blobs" },
      auth,
    }),
    httpEndpoint({
      id: "store.route.admin.doc.delete",
      name: `Store · DELETE ${API}${PATHS.doc}`,
      method: "DELETE",
      path: `${API}${PATHS.doc}`,
      op: "store.admin.doc.delete",
      io: { in: { collection: fromParams(), id: fromParams() }, out: "result" },
      auth,
    }),
    httpEndpoint({
      id: "store.route.admin.blob.delete",
      name: `Store · DELETE ${API}${PATHS.blob}`,
      method: "DELETE",
      path: `${API}${PATHS.blob}`,
      op: "store.admin.blob.delete",
      io: { in: { id: fromParams() }, out: "result" },
      auth,
    }),
  ];
}
