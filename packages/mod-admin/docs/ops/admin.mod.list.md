Installed mods and what each one contributed: `[{ name, ops, workflows,
frontend? }]`. `ops` and `workflows` are the op types and workflow ids the mod
registered; `frontend` counts its menu entries, pages and commands and names
its assets filesystem. This backs the Reference → Mods page. For a single op,
`admin.op.get` gives the same answer through its `mod` field.

Route: `GET /admin/api/mods`. Scope: `workflows:read`.
