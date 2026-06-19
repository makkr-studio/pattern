import type { FrontendContribution } from "@pattern/core";

/**
 * The admin contribution — a menu entry, a ⌘K command, and a page, all bound to
 * the mod's own dedicated route (`/{{name}}/items`, relative to the admin API
 * mount). Tier 1 is a declarative table (no build step); Tier 2 is a custom
 * React page (the ESM remote in `app.ts`).
 */
const PAGE = "/x/{{name}}";
const ROUTE = { method: "GET", path: "/{{name}}/items" } as const;

const base = {
  menu: [{ category: "Extensions", label: "{{Title}}", icon: "boxes", path: PAGE, order: 50 }],
  commands: [{ id: "{{opPrefix}}.items", label: "{{Title}}: list items", group: "Extensions", route: ROUTE }],
};

/** Tier 1 — a declarative table rendered by the admin's component kit. */
export const frontendTier1: FrontendContribution = {
  ...base,
  pages: [
    {
      path: PAGE,
      view: {
        kind: "table",
        route: ROUTE,
        columns: [
          { key: "id", label: "ID" },
          { key: "label", label: "Label" },
        ],
      },
    },
  ],
};

/** Tier 2 — a custom React page, the ESM remote served at `/ext/{{name}}.js`. */
export const frontendTier2: FrontendContribution = {
  ...base,
  pages: [{ path: PAGE, remote: "/ext/{{name}}.js" }],
};
