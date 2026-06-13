---
title: Authoring tools
order: 10
---

# Authoring agent tools

A tool is just a workflow with a `boundary.tool` trigger. Three things make it
a good tool.

## 1. A tight schema

The trigger's `params` is a JSON Schema the **engine validates** before your
graph runs — the model's arguments are checked at the door, so a hallucinated
shape becomes a clean validation error, never a malformed value deep in your
logic. Be specific: required fields, enums, descriptions (the model reads
them).

## 2. A real return

Wire your result into `boundary.tool.return`'s `result` — that's what the
model sees. Keep it small and structured; the model pays attention tokens for
every field. A weather tool returns `{ tempC, summary }`, not the raw API
envelope.

## 3. It's debuggable for free

Every tool call runs as a **linked sub-run**. Open the agent's run in the
admin and each tool invocation is a child run with its own node waterfall and
sampled I/O — you see exactly what the model passed and what came back. No
print-debugging an opaque function.

## Three origins, one toolbox

- **Workflow tools** — what we just built; `agents.tools.workflows` collects
  every `boundary.tool` in the app (or a named subset).
- **MCP servers** — `agents.mcp.server` exposes an MCP server's tools
  (pooled per process).
- **Op tools** — a mod can register plain-function tools
  (`agents.tools.ops`).

Merge any combination with `agents.tools.merge` and wire the result into
`agents.agent`'s tools input.

## Gating a tool behind approval

Set `needsApproval: true` on the `boundary.tool` config and the agent pauses
before the call, emitting an `approval.request`. The chat app turns that into
Approve/Deny buttons; `agents.run.resume` continues the same turn with the
decision. Use it for tools with side effects (sending mail, spending money).
