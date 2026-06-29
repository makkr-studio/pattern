# workflows/

Drop `*.json` workflow files here; they register at boot (hot-reloaded by
`npm run dev`) and show up in the admin as read-only (fork to edit a copy).

Workflows you author **in the admin** live in `./.pattern` instead, with
versions and audit. Both are just JSON documents; `npx pattern graph <file>`
prints any of them as a terminal graph.
