import type { FrontendContribution } from "@pattern-js/core";

/**
 * The admin contribution — a menu entry, a ⌘K command, and a page, all bound to
 * the mod's own dedicated route (`/{{name}}/items`, relative to the admin API
 * mount). Tier 1 is a declarative table (no build step); Tier 2 is a custom
 * React page shipped as `module` SOURCE — the admin serves it same-origin and
 * imports it (no workflow, no asset mount).
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

/**
 * The Tier-2 page SOURCE — an ESM module (default export = the component).
 *
 * It reads everything off the admin's shared global (`__PATTERN_ADMIN__`): the
 * host's React, the authenticated API client, the glass UI kit, plus motion.dev
 * and lucide. So the page uses the admin's *exact* stack — same React instance,
 * same design system — with no bundler and no duplicate dependencies. Tailwind
 * utility classes work too (the admin's stylesheet is global). The admin serves
 * this string from its own same-origin route and `import()`s it.
 *
 * Bringing your own stack? Build a single-file ESM bundle (React externalized to
 * the global) and assign the built string here — never bundle your own React, or
 * the admin's renderer and your component's hooks will disagree.
 */
const PAGE_SOURCE = `
const { React, api, ui, motion, lucide } = (globalThis).__PATTERN_ADMIN__;
const { GlassPanel, PageHeader, NeonButton, Badge, JsonView } = ui;
const Icon = lucide.Boxes ?? lucide.Box;
const h = React.createElement;

export default function {{Title}}Page() {
  const [items, setItems] = React.useState(null);
  return h(
    "div",
    null,
    h(PageHeader, {
      title: "{{Title}}",
      subtitle: "A Tier-2 page from {{pkgName}} — the admin's React, UI kit, motion & lucide, no bundler.",
      actions: h(Badge, { hue: 280 }, "tier 2"),
    }),
    h(
      GlassPanel,
      { className: "p-6 space-y-4" },
      h(
        motion.div,
        { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 } },
        h(
          "p",
          { className: "text-muted text-sm flex items-center gap-2" },
          Icon && h(Icon, { size: 16 }),
          "Loaded from the admin's shared stack — replace this with your UI.",
        ),
      ),
      h(NeonButton, { onClick: () => api.call("GET", "/{{name}}/items").then(setItems) }, "Load items"),
      items && h(JsonView, { value: items, className: "max-h-64" }),
    ),
  );
}
`;

/** Tier 2 — a custom React page; the admin serves the source and imports it (no workflow). */
export const frontendTier2: FrontendContribution = {
  ...base,
  pages: [{ path: PAGE, module: PAGE_SOURCE }],
};
