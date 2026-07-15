# Buddy

`@pattern-js/mod-buddy` puts an assistant **inside the editor**: describe what
you want, and Buddy drafts the workflow — grounding itself in this app's
handbook and op catalog, repairing its own mistakes against the validator,
and applying proposals to your open canvas as ordinary, undoable edits. You
keep the Save and Deploy buttons. And because Buddy's own pipeline is a
Pattern workflow, you can open it on the canvas and reshape it.

```jsonc
{
  "mods": [
    "@pattern-js/mod-ai", "@pattern-js/mod-agents", "@pattern-js/mod-docs",
    "@pattern-js/mod-admin", "@pattern-js/mod-identity",
    "@pattern-js/mod-buddy"
  ]
}
```

`@pattern-js/mod-docs` is a **hard requirement**, not a nicety: the
`pattern_list_ops` / `pattern_get_op` / `pattern_search_docs` tools wire its
`docs.*` ops, and the knowledge engine retrieves over its handbook. Load
order in `mods` doesn't matter — seeded workflows register once every mod's
ops are in.

Optional but recommended: `@pattern-js/mod-store` (threads survive reloads)
and `@pattern-js/mod-vectors` (semantic knowledge — see below).

## The control-plane tools

Buddy's hands are ten **restricted** `boundary.tool` workflows — the
`pattern_*` control plane:

| Tool | What it does | Scope its ops demand |
| --- | --- | --- |
| `pattern_list_ops` / `pattern_get_op` | the op catalog, schemas + prose | `workflows:read` |
| `pattern_search_docs` | handbook + catalog retrieval | `workflows:read` |
| `pattern_get_workflow` | meta, versions, live/latest docs | `workflows:read` |
| `pattern_validate_workflow` | located errors, nothing saved | `workflows:read` |
| `pattern_propose_workflow` | validate + surface an Apply card | `workflows:read` |
| `pattern_save_workflow_draft` | mint an immutable draft version | `workflows:write` |
| `pattern_deploy_workflow` | activate a version (needs approval) | `deploy` |
| `pattern_list_runs` / `pattern_get_run` | traces, spans, masked I/O | `runs:read` |

`restricted: true` keeps them out of every `["*"]` toolset and MCP wildcard —
they are offered only by explicit name, and every call is a traced sub-run on
the Runs page.

## The same tools, outside: the Pattern MCP server

`POST /mcp/pattern` exposes exactly these ten tools to external MCP clients
(Claude Code, Cursor, …), gated by **API tokens** (admin → Access → API
tokens). A token's scopes decide what succeeds: `workflows:read` +
`workflows:write` makes an authoring token that can draft but never ship;
`deploy` is its own decision. For local dev, `pattern mcp` serves the same
tools over stdio with no token — your shell already owns the box.

## Knowledge: lexical first, semantic when present

`buddy.knowledge.search` answers from the live handbook and op catalog. The
baseline is lexical — genuinely strong on structured docs and exact op names.
When `@pattern-js/mod-vectors` **and an embedding alias** are installed, a
boot indexer chunks the handbook into the `buddy.docs` collection
(content-hashed — upgrades re-embed only the diff) and the same op silently
upgrades to hybrid semantic retrieval. Name an embedding alias `buddy` to
pin which model indexes; otherwise the first embedding alias wins.

## Threads, model, and the pipeline

- Conversations persist per (workflow, user) in mod-store's `buddy.threads`
  — reload the editor and the conversation is still there.
- Buddy runs on the `buddy` **language alias** when you define one (Settings →
  AI Providers), else the app's default alias.
- The whole turn is the `buddy.turn` workflow: request → `buddy.turn.begin`
  (thread + context + model) → agent + tools → SSE out, history saved back.
  Fork it, add a guardrail, swap the toolset — it's yours.
