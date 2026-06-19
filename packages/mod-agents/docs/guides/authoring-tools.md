---
title: Authoring tools
order: 10
---

# Authoring agent tools

A tool is just a workflow with a `boundary.tool` trigger and a
`boundary.tool.return` out-gate. Reach for one whenever the model needs to
*do* something — look data up, call an API, change state — rather than only
talk. Three things make it a good tool.

## 1. A tight schema

The trigger's `params` is a JSON Schema the **engine validates** before your
graph runs — the model's arguments are checked at the door, so a hallucinated
shape becomes a clean `TriggerInputError`, never a malformed value deep in
your logic. Be specific: required fields, enums, and descriptions (the model
reads them to decide *when* and *how* to call).

```jsonc
// workflows/tool-weather.json
{ "id": "tool-weather",
  "nodes": [
    { "id": "in", "op": "boundary.tool",
      "config": {
        "name": "get_weather",
        "description": "Current weather for a city.",
        "params": {
          "type": "object",
          "properties": { "city": { "type": "string", "description": "City name, e.g. \"Lyon\"" } },
          "required": ["city"] } } },
    { "id": "fetch", "op": "…your graph…", "comment": "call the weather API" },
    { "id": "out",   "op": "boundary.tool.return" } ],
  "edges": [
    { "from": { "node": "in",    "port": "args" },   "to": { "node": "fetch", "port": "in" } },
    { "from": { "node": "fetch", "port": "result" }, "to": { "node": "out",   "port": "result" } } ] }
```

The trigger outputs `args` (validated against your schema) and `user` (the
calling principal). In the editor, `params` is a visual SchemaBuilder.

## 2. A real return

Wire your result into `boundary.tool.return`'s `result` — that's exactly what
the model sees. Keep it small and structured; the model pays attention tokens
for every field. A weather tool returns `{ tempC, summary }`, not the raw API
envelope. `boundary.tool.return` is the only legal terminal for a tool
workflow, so every branch must converge on it.

## 3. It's debuggable for free

Every tool call runs as a **linked sub-run** (`ctx.invoke`). Open the agent's
run in the admin and each invocation is a child run (↳) with its own node
waterfall and sampled I/O — you see exactly what the model passed and what
came back. No print-debugging an opaque function.

## Three origins — and when to choose each

- **Workflow tools** — what we just built; `agents.tools.workflows` collects
  every `boundary.tool` in the app (or a named subset). The default: visible,
  debuggable, yours. With no names it auto-includes everything *except*
  guardrail-only tools.
- **MCP servers** — `agents.mcp.server` exposes an existing MCP server's tools
  (HTTP or stdio, pooled per process). Choose this to borrow tools you don't
  want to re-implement.
- **Op tools** — a mod registers plain-function tools in its setup
  (`AGENTS_SERVICE.registerOpTool`), picked by `agents.tools.ops`. Choose this
  for tools a mod ships as code rather than a visible workflow.

Merge any combination with `agents.tools.merge` (config `count` = how many
toolset inputs) and wire the result into `agents.agent`'s `tools` input.

## Gating a tool behind approval (HITL)

Set `needsApproval: true` on the `boundary.tool` config and the agent pauses
before the call, emitting an `approval.request` (with an opaque resume
`stateToken`). The chat app turns that into Approve/Deny buttons;
`agents.run.resume` continues the **same** turn with the decision. Use it for
tools with side effects — sending mail, spending money, deleting rows.

## Authoring a guardrail

A guardrail reuses the **same** `boundary.tool` pair: a tool workflow whose
`result` is `{ tripwire: boolean, info? }`. The provider calls it as an input
or output guardrail (a linked sub-run, like any tool), and a `tripwire: true`
ends the turn cleanly with an inline card.

1. Author the classifier as a `boundary.tool` workflow. Mark it
   `guardrail: true` so `agents.tools.workflows` leaves it **out** of the
   model's callable toolbox — a moderation classifier must not become a tool
   the model can invoke.
2. Wrap it with `agents.guardrail` (config: `tool` = the workflow's name,
   `direction` = `input` | `output`).
3. Wire the descriptor into `agents.agent`'s `guardrails` input (one or an
   array).

Input guardrails vet the user's message before the model sees it; output
guardrails vet the model's answer before it reaches the user.
