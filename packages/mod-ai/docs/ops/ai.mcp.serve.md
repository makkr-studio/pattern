Make this app an MCP server. Wire the whole JSON-RPC request body into
`request` and `response` into `boundary.http.response`'s `body`; the op
answers `initialize`, `ping`, `tools/list` and `tools/call` (single messages
or batches). Notifications get an empty `{}` body.

The tools are your `boundary.tool` workflows. `tools/call` runs one through
`ctx.invoke`, a linked sub-run with the engine's argument validation and
tracing, and returns its `result` as text content; a failing tool comes back as
`isError` content for the client to read. Config `tools` lists the names to
expose. Empty or `["*"]` exposes every tool except guardrails and `restricted`
ones (the `pattern_*` control plane), which are served only when named.
`tools/call` enforces the same set as `tools/list`, so the list is a real
boundary.

mod-ai ships this wiring as the `POST /mcp` workflow, public by default for
local development. Fork it to narrow `tools`, set `requireAuth` on the
request node, or move the path. Config `name` and `version` are what clients
see in `serverInfo`.
