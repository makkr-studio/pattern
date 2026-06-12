/**
 * @pattern/mod-store — admin Data browser (Tier-1 declarative, zero build).
 *
 * Collections → documents → one document (full JSON), plus Blobs. Sources
 * are the `store.admin.*` ops (admin-scope-guarded in-op).
 */

import type { FrontendContribution } from "@pattern/core";

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
          source: "store.admin.collections",
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
          source: "store.admin.docs",
          columns: [
            { key: "id", label: "Id" },
            { key: "version", label: "v" },
            { key: "updated", label: "Updated", format: "date" },
            { key: "preview", label: "Data" },
          ],
          rowActions: [
            { label: "View", path: "/x/store/docs/:collection/:id", args: { collection: "collection", id: "id" }, icon: "eye" },
            { label: "Delete", run: "store.admin.doc.delete", args: { collection: "collection", id: "id" }, icon: "trash-2", confirm: true },
          ],
        },
      },
      {
        path: "/x/store/docs/:collection/:id",
        view: { kind: "json", source: "store.admin.doc.get" },
      },
      {
        path: "/x/store/blobs",
        view: {
          kind: "table",
          source: "store.admin.blobs",
          columns: [
            { key: "id", label: "Id" },
            { key: "mime", label: "Type" },
            { key: "size", label: "Bytes" },
            { key: "owner", label: "Owner" },
            { key: "created", label: "Created", format: "date" },
          ],
          rowActions: [
            { label: "Delete", run: "store.admin.blob.delete", args: { id: "id" }, icon: "trash-2", confirm: true },
          ],
        },
      },
    ],
  };
}
