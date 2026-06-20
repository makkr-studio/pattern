# Agents (contracts)

`@pattern-js/mod-agents` is the **neutral** agents layer — plain-JSON
descriptors and the turn event protocol, with no SDK dependency. Provider
mods (like `@pattern-js/mod-agents-openai`) reify the descriptors into running
agents; apps (like `@pattern-js/mod-chat`) consume the events. Neither has to
know about the other.

## When to use

Install this whenever you want agents in your app — but you never install it
*alone*. It contributes the `boundary.tool` pair, the toolset/guardrail ops,
and the live tool registry (`AGENTS_SERVICE`); it does **not** run an agent.
Pair it with a provider (`@pattern-js/mod-agents-openai`) for `agents.agent` /
`agents.run`, and usually with `@pattern-js/mod-store` (history + blobs) and
`@pattern-js/mod-vault` (the API key).

**When not:** if all you need is a single model call with no tools, no agent
loop, and no streaming turn events, a provider op straight from the canvas is
lighter than the agents stack. The agents layer earns its keep the moment
there are tools, handoffs, guardrails, or a live transcript.

```jsonc
// pattern.config.json — the contracts always ship with a provider
{ "mods": ["@pattern-js/mod-agents", "@pattern-js/mod-agents-openai"] }
```

## Tools are workflows

A tool is a **workflow** that starts with a `boundary.tool` trigger and ends
with `boundary.tool.return`. The trigger's config carries the `name` and
`description` the model reads, plus a JSON-Schema `params` the **engine**
validates before your graph runs — a model's hallucinated args become a clean
`TriggerInputError` at the door, never a malformed value deep in your logic.
That one shape also buys discovery (the registry scans for these triggers,
live) and debugging: every call is a **linked sub-run** (↳ in the Runs page,
with sampled I/O), so the admin's run view is your agent debugger.

### Three tool origins — and when to choose each

| origin | op | reach for it when |
| --- | --- | --- |
| **workflow** | `agents.tools.workflows` | the tool is your own logic, and you want it visible/debuggable on the canvas (the default — drop a `boundary.tool` workflow in the app and every agent picks it up). |
| **MCP server** | `agents.mcp.server` (provider mod) | you want to expose an existing MCP server's tools (HTTP or stdio) without re-implementing them. |
| **op (code)** | `agents.tools.ops` | a mod ships a ready-made tool as a plain function (registered via `AGENTS_SERVICE.registerOpTool` in setup) rather than a visible workflow. |

`agents.tools.workflows` with no names auto-collects every `boundary.tool` in
the app **except** guardrail-only ones (`guardrail: true` on the trigger keeps
a moderation classifier from becoming a callable tool — name it explicitly to
include it anyway). Combine any origins with `agents.tools.merge` (config
`count` sets the input ports) and wire the result into `agents.agent`'s
`tools` input.

## Guardrails reuse the tool shape

A guardrail is the same `boundary.tool` pair by convention — a tool workflow
whose `result` is `{ tripwire: boolean, info? }`. `agents.guardrail` wraps a
named tool workflow as an `input` or `output` guardrail descriptor; input
guardrails vet the user's message before the model sees it, output guardrails
vet the answer. A trip surfaces as an inline error card in the chat and the
turn ends cleanly with the reason — never a crash. Mark the underlying tool
`guardrail: true` so it stays out of the model's callable toolbox.

## The turn event protocol

A running agent emits one **modality-agnostic** stream that every surface
speaks — SSE responses, the chat's persisted log, future voice surfaces:

- `text.delta` / `text.done` — streaming text, then the settled message.
- `tool.activity` — a tool's lifecycle (`start` → `done` | `error`), with an
  optional `subRunId` deep-linking into the admin.
- `approval.request` — the turn paused for human approval (HITL), carrying an
  opaque `stateToken` only the provider mod reads.
- `error` — errors are turn **content** (chats render an inline card, not a
  toast).
- `audio.ref` — reserved for the voice round.
- `done { stopReason }` — a **guaranteed** terminal event
  (`complete | interrupted | error | cancelled`), so a consumer can always
  settle.

These are event-name constants on the wire, not ops. Descriptors and events
are both plain JSON (structured-cloneable) so they flow on edges and cross
worker boundaries; provider SDK objects never do — a provider mod reifies
descriptors into SDK instances only at execute time.

## Integration

- **Provider** (`@pattern-js/mod-agents-openai`) — meets this mod at the
  `AGENTS_SERVICE` service seam: it asks the registry for tools, nobody
  imports a provider to find them. Reifies descriptors → SDK; emits the turn
  events.
- **`@pattern-js/mod-store`** — history is opaque provider items pulled from a
  store and pushed back; image-part tools resolve blob ids through it.
- **`@pattern-js/mod-chat`** — the product surface; its `chat.turn.pipeline`
  wires `agents.tools.workflows` → `agents.agent` → `agents.run` and persists
  the event stream.

## The agentic shape

Request → extract the user's message → collect tools + define the agent →
run → stream the response. The canvas version, end to end:

```workflow
{ "id": "agent.turn",
  "name": "Agent · one turn",
  "nodes": [
    { "id": "in",    "op": "boundary.http.request", "config": { "method": "POST", "path": "/api/agent" } },
    { "id": "msg",   "op": "core.object.get", "config": { "path": "message" }, "comment": "the user's text out of the body" },
    { "id": "tools", "op": "agents.tools.workflows", "comment": "every boundary.tool in the app; name a subset to narrow" },
    { "id": "agent", "op": "agents.agent", "config": { "name": "assistant", "instructions": "You are a helpful assistant." } },
    { "id": "run",   "op": "agents.run", "comment": "streams turn events; needs an API key" },
    { "id": "out",   "op": "boundary.http.response" } ],
  "edges": [
    { "from": { "node": "in",    "port": "body" },    "to": { "node": "msg",   "port": "object" } },
    { "from": { "node": "tools", "port": "toolset" }, "to": { "node": "agent", "port": "tools" } },
    { "from": { "node": "agent", "port": "agent" },   "to": { "node": "run",   "port": "agent" } },
    { "from": { "node": "msg",   "port": "out" },     "to": { "node": "run",   "port": "input" } },
    { "from": { "node": "run",   "port": "events" },  "to": { "node": "out",   "port": "stream" } } ] }
```

For the full agentic app (history, persistence, approvals, Stop), use
`@pattern-js/mod-chat` — its turn pipeline is this shape, hardened.
