/**
 * @pattern-js/mod-vectors — the admin surface (Tier-1 declarative, zero build).
 *
 * One Collections page under Data: name, alias, dims, filterables, row count,
 * engine — the at-a-glance answer to "what is indexed and through which
 * model". Backed by one dedicated admin-scoped route.
 */

import { httpEndpoint, value, type FrontendContribution, type OpDefinition, type Workflow } from "@pattern-js/core";
import { VECTORS_SERVICE, type VectorsService } from "./service.js";

const PATH = "/vectors/api/collections";
const API = "/admin/api";

/** Backing op for the collections table (privileged; the route carries the admin gate). */
export const collectionsListOp: OpDefinition = {
  type: "vectors.collections.list",
  title: "vectors.collections.list",
  description: "List vector collections with alias, dims, filterables, row count and the active engine (admin).",
  reusable: false,
  sensitivity: "privileged",
  inputs: {},
  outputs: { collections: value() },
  execute: async (ctx) => {
    const svc = ctx.services[VECTORS_SERVICE] as VectorsService | undefined;
    if (!svc) return { collections: [] };
    const collections = await svc.listCollections();
    return {
      collections: collections.map((c) => ({
        name: c.name,
        alias: c.alias,
        dims: c.dims ?? "(locks on first write)",
        filterables: c.filterables.join(", ") || "—",
        rows: c.rows,
        engine: svc.engineId(),
      })),
    };
  },
};

export function vectorsAdminRoutes(): Workflow[] {
  return [
    httpEndpoint({
      id: "vectors.route.admin.collections",
      name: `Vectors · GET ${API}${PATH}`,
      method: "GET",
      path: `${API}${PATH}`,
      op: "vectors.collections.list",
      io: { out: "collections" },
      auth: { scopes: ["admin"] },
    }),
  ];
}

export function vectorsFrontend(): FrontendContribution {
  return {
    menu: [{ category: "Data", label: "Vectors", icon: "network", path: "/x/vectors/collections", order: 30 }],
    pages: [
      {
        path: "/x/vectors/collections",
        view: {
          kind: "table",
          route: { method: "GET", path: PATH },
          columns: [
            { key: "name", label: "Collection" },
            { key: "alias", label: "Embedding alias" },
            { key: "dims", label: "Dims" },
            { key: "filterables", label: "Filterables" },
            { key: "rows", label: "Rows" },
            { key: "engine", label: "Engine" },
          ],
        },
      },
    ],
  };
}
