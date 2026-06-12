# Admin

`@pattern/mod-admin` is the control surface at `/admin`: the visual workflow
editor, live deploy with route-conflict checks, run inspection (per-node
waterfalls, sampled I/O with secrets masked, linked sub-runs), replay,
versioning with diffs, metrics, and the catalog of every op/mod/workflow.

It is a mod like any other — and it **edits itself**: every admin API route
is a workflow built from the same primitives you author with, so the admin's
own control plane appears in its catalog.

## Extension points

- **Declarative pages**: mods contribute menu entries + table/detail views
  over their own ops (`frontend` contribution) — the Data browser, Secrets,
  and Chat conversations pages all arrive this way.
- **⌘K commands**, **settings sections**, and full Tier-2 bundles for
  custom UI.

See the handbook's [The admin](/docs/docs/guides/admin) guide for the tour.
