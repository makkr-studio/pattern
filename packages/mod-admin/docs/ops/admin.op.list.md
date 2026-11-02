The op catalog: every registered op (base and mod) as an `OpInfo`, sorted by
category, then type. Each entry carries `type`, `title`, `description`,
`category` (from the type prefix), `mod` (the contributing mod, absent for
the base catalog), `inputs`, `outputs` and `configInputs` with JSON Schemas,
`controlOut`, `configSchema`, `boundary` and `pair`, `reusable`, `cpuHeavy`,
`effects` (`dynamic` when config decides it) and `usedBy` /
`usedByWorkflows` across registered workflows.

Ports are resolved against an empty config, so an op whose ports depend on
config shows its defaults; ask `admin.doc.ports` for a real node's ports.
This feeds the editor palette and the Reference → Ops page. For one op, use
`admin.op.get`.

Route: `GET /admin/api/ops`. Scope: `workflows:read`.
