The aggregated frontend manifest the admin shell builds its navigation from:
`{ menu, commands, assets, pages, settings, checklists, authProvider }`,
merged from every installed mod's `frontend` contribution. Pages are made
serialisable: declarative `view` / `views` pages pass through with their
header chrome; a page with a `module` source becomes
`remote: "/admin/api/ui/page/<slug>"`, which the shell imports (served by
`admin.ui.page`); a page loaded by a function is flagged `tier2: true`.

`authProvider` tells the editor whether a declared `requireAuth` is actually
enforced, so it can warn authors when no auth mod is installed.

Route: `GET /admin/api/ui/manifest`. Scope: `admin` (root).
