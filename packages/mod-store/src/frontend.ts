/**
 * @pattern/mod-store — admin Data browser (Tier-1 declarative, zero build).
 *
 * Collections → documents → one document (full JSON), plus Blobs. Every view
 * and action names its own dedicated route (see `./admin-routes.ts`) — there is
 * no generic op invoker; the renderer just wires over purposeful endpoints.
 */

import type { FrontendContribution } from "@pattern/core";
import { PATHS } from "./admin-routes.js";

export function storeFrontend(): FrontendContribution {
  return {
    menu: [
      { category: "Data", label: "Collections", icon: "database", path: "/x/store/collections", order: 10 },
      { category: "Data", label: "Blobs", icon: "file-archive", path: "/x/store/blobs", order: 20 },
    ],
    pages: [
      {
        path: "/x/store/collections",
        view: {
          kind: "table",
          route: { method: "GET", path: PATHS.collections },
          columns: [
            { key: "name", label: "Collection" },
            { key: "indexes", label: "Indexed fields" },
            { key: "docs", label: "Docs" },
          ],
          rowActions: [
            { label: "Browse", path: "/x/store/collections/:collection", args: { collection: "name" }, icon: "folder-open" },
          ],
        },
      },
      {
        path: "/x/store/collections/:collection",
        view: {
          kind: "table",
          route: { method: "GET", path: PATHS.docs },
          columns: [
            { key: "id", label: "Id" },
            { key: "version", label: "v" },
            { key: "updated", label: "Updated", format: "date" },
            { key: "preview", label: "Data" },
          ],
          rowActions: [
            { label: "View", path: "/x/store/docs/:collection/:id", args: { collection: "collection", id: "id" }, icon: "eye" },
            { label: "Delete", route: { method: "DELETE", path: PATHS.doc }, args: { collection: "collection", id: "id" }, icon: "trash-2", confirm: true },
          ],
        },
      },
      {
        path: "/x/store/docs/:collection/:id",
        view: { kind: "json", route: { method: "GET", path: PATHS.doc } },
      },
      {
        path: "/x/store/blobs",
        view: {
          kind: "table",
          route: { method: "GET", path: PATHS.blobs },
          columns: [
            { key: "id", label: "Id" },
            { key: "mime", label: "Type" },
            { key: "size", label: "Bytes" },
            { key: "owner", label: "Owner" },
            { key: "created", label: "Created", format: "date" },
          ],
          rowActions: [
            { label: "Delete", route: { method: "DELETE", path: PATHS.blob }, args: { id: "id" }, icon: "trash-2", confirm: true },
          ],
        },
      },
    ],
  };
}
