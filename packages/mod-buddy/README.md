# @pattern-js/mod-buddy

Buddy — the workflow assistant inside
[Pattern](https://github.com/makkr-studio/pattern)'s admin, and the Pattern
**control plane**: ten restricted `pattern_*` tool workflows (list/search the
catalog and docs, read workflows and runs, validate, propose, save drafts,
deploy-with-approval) consumed three ways —

- **the editor dock**: Buddy drafts workflows, self-repairs against the
  validator, debugs failed runs from traces, and applies proposals to your
  open canvas; you keep Save and Deploy,
- **`POST /mcp/pattern`**: the same tools for external MCP clients, gated by
  scoped API tokens (author vs deploy split),
- **`pattern mcp`**: stdio for local dev — Claude Code or Cursor becomes a
  Pattern author.

Knowledge is lexical over the live handbook by default and silently upgrades
to hybrid semantic retrieval when `@pattern-js/mod-vectors` + an embedding
alias are installed. Threads persist via `@pattern-js/mod-store` when
present. Buddy's own turn pipeline is a Pattern workflow — open it on the
canvas.

Full chapter: your app's `/docs` → **Buddy** (or
[the handbook source](./docs/index.md)).
