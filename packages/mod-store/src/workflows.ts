/**
 * @pattern/mod-store — shipped workflows.
 *
 * One route: GET /store/blobs/:id streams a blob with its stored mime type
 * (chunked). Ids are unguessable UUIDs; gate the route via the mod's
 * `blobRoute.requireAuth` option when that's not enough.
 */

import type { Workflow } from "@pattern/core";

export function blobServeWorkflow(requireAuth?: unknown): Workflow {
  return {
    id: "store.route.blob",
    name: "Store · GET /store/blobs/:id",
    source: "code",
    nodes: [
      {
        id: "in",
        op: "boundary.http.request",
        config: {
          method: "GET",
          path: "/store/blobs/:id",
          ...(requireAuth !== undefined ? { requireAuth } : {}),
        },
      },
      { id: "pick", op: "core.object.get", config: { path: "id" } },
      { id: "blob", op: "store.blob.get" },
      { id: "out", op: "boundary.http.response", config: { mode: "chunked" } },
    ],
    edges: [
      { from: { node: "in", port: "params" }, to: { node: "pick", port: "object" } },
      { from: { node: "pick", port: "out" }, to: { node: "blob", port: "id" } },
      { from: { node: "blob", port: "status" }, to: { node: "out", port: "status" } },
      { from: { node: "blob", port: "headers" }, to: { node: "out", port: "headers" } },
      { from: { node: "blob", port: "bytes" }, to: { node: "out", port: "stream" } },
    ],
  };
}
