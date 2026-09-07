/**
 * @pattern-js/mod-admin — the admin's own frontend contribution (admin internals §6).
 *
 * The admin builds its nav from the *same* `FrontendContribution` surface mods
 * use (dogfooding = proof the surface is sufficient). The declarative pages here
 * read from the admin's own workflow-backed endpoints, so self-reflection holds.
 * `assets` points at the registered filesystem the SPA is served from.
 */

import type { FrontendContribution } from "@pattern-js/core";

const ASSETS_FS = "admin-assets";

export function adminFrontend(_mount: string): FrontendContribution {
  return {
    assets: ASSETS_FS,
    // The section vocabulary is `ADMIN_SECTIONS` (admin-sdk). A workflow has
    // no top-level "Editor" destination: it opens from the catalog as its own
    // workspace (Editor · Runs · Versions · Settings under /workflows/:slug).
    menu: [
      { category: "Home", label: "Home", icon: "home", path: "/", order: 1 },
      { category: "Workflows", label: "Workflows", icon: "workflow", path: "/workflows", order: 1 },
      { category: "Activity", label: "Runs", icon: "activity", path: "/runs", order: 10 },
      { category: "Activity", label: "Metrics", icon: "bar-chart", path: "/metrics", order: 20 },
      { category: "Activity", label: "Process", icon: "cpu", path: "/process", order: 30 },
      { category: "Administration", label: "Settings", icon: "settings", path: "/settings", order: 90 },
      { category: "Reference", label: "Ops", icon: "boxes", path: "/ops", order: 10 },
      { category: "Reference", label: "Mods", icon: "package", path: "/mods", order: 20 },
      { category: "Reference", label: "System map", icon: "network", path: "/system", order: 30 },
    ],
    // The admin renders its own routes as bespoke React pages; mods contribute
    // declarative `pages` through this same surface (rendered by the SDK kit).
    pages: [],
    commands: [{ id: "admin.new", label: "New workflow…", group: "Workflows", icon: "plus", path: "/workflows/new" }],
  };
}
