/**
 * @pattern/mod-admin — the admin's own frontend contribution (mod-admin-spec §6).
 *
 * The admin builds its nav from the *same* `FrontendContribution` surface mods
 * use (dogfooding = proof the surface is sufficient). The declarative pages here
 * read from the admin's own workflow-backed endpoints, so self-reflection holds.
 * `assets` points at the registered filesystem the SPA is served from.
 */

import type { FrontendContribution } from "@pattern/core";

const ASSETS_FS = "admin-assets";

export function adminFrontend(_mount: string): FrontendContribution {
  return {
    assets: ASSETS_FS,
    menu: [
      { category: "Author", label: "Workflows", icon: "workflow", path: "/workflows", order: 10 },
      { category: "Author", label: "Editor", icon: "git-branch", path: "/editor", order: 20 },
      { category: "Observe", label: "Runs", icon: "activity", path: "/runs", order: 10 },
      { category: "Observe", label: "Metrics", icon: "bar-chart", path: "/metrics", order: 20 },
      { category: "Catalog", label: "Ops", icon: "boxes", path: "/ops", order: 10 },
      { category: "Catalog", label: "Mods", icon: "package", path: "/mods", order: 20 },
      { category: "System", label: "System map", icon: "network", path: "/system", order: 10 },
    ],
    // The admin renders its own routes as bespoke React pages; mods contribute
    // declarative `pages` through this same surface (rendered by the SDK kit).
    pages: [],
    commands: [
      { id: "admin.new", label: "New workflow…", group: "Author", icon: "plus" },
      { id: "admin.deploy", label: "Deploy…", group: "Author", icon: "rocket" },
    ],
  };
}
