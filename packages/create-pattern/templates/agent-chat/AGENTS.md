# Agent guide: {{name}} (Pattern · agent-chat modpack)

You are working in a **Pattern** project running a complete AI-agent chat:
`/chat` is a product chat app whose every turn executes a **workflow**,
`chat.turn.pipeline`, visible in the admin at `/admin`. The agent, its tools
and its guardrails are graph nodes. Your job is usually one of: add a tool,
tune the agent, add a guardrail, or rewire the pipeline. Recipes below.

## Ground rules

1. **Never guess op names or ports.** Ground truth is one command away:
   - `npx pattern ops agents`: the agent ops (agent, run, tools, guardrail…)
   - `npx pattern ops chat`: the chat pipeline ops
   - `npx pattern ops <type>`: full ports + config detail for any op
2. **Validate every workflow JSON you touch:** `npx pattern validate <file>`.
3. The chat agent needs a **model** and a **key**. The model is the default set
   in admin → Settings → AI Providers (or wire an `ai.model` node into the
   pipeline's `agents.agent.model`). The provider key resolves by name:
   `OPENAI_API_KEY` in `.env` (copied from `.env.example`; loaded automatically,
   real env wins) → a vault secret of that name (admin → System → Secrets,
   masked out of run samples). Gateway routing uses one `AI_GATEWAY_API_KEY`
   instead. `PATTERN_VAULT_KEY` (the vault's master key) belongs in `.env`.
4. Don't edit `./.pattern` by hand; `./.pattern-data` is runtime data
   (conversations, blobs, secrets) and is gitignored.
5. **Prefer the `pattern_*` MCP tools when you have them.** This project ships
   `.mcp.json` → `pattern mcp`, so Claude Code (and any MCP client) connects to
   the running engine's control plane: `pattern_list_ops` / `pattern_get_op`
   (ground truth instead of guessing), `pattern_search_docs`,
   `pattern_get_workflow`, `pattern_validate_workflow` (validate BEFORE you
   propose), `pattern_save_workflow_draft` (drafts only — deploying stays
   human), `pattern_list_runs` / `pattern_get_run` (debug from real traces).

## Mental model (60 seconds)

- A chat turn = `POST /chat/api/conversations/:id/turns` → the
  `chat.turn.pipeline` workflow: `chat.turn.begin` (scoping + a one-turn-
  at-a-time lease) → `agents.tools.workflows` → `agents.agent` →
  `agents.run` → SSE response + `chat.events.sink` (persists every event;
  the chat UI replays from the store on refresh).
- **A tool is a workflow** starting with `boundary.tool` (name, description,
  `params` as JSON Schema, engine-validated before your graph runs) and
  ending with `boundary.tool.return` ({ result }). Every call shows up in the
  admin Runs page as a linked sub-run (↳) with sampled I/O.
- Agents, toolsets and guardrails are **values on edges**; wire
  `agents.guardrail` or extra toolsets into the `agents.agent` node.

## Recipes

### Add a tool the agent can call

Create `workflows/tool-<name>.json` (see `tool-time.json` for the minimal
shape, `tool-weather.json` for validated params + an outbound HTTP call):

1. `boundary.tool` trigger: config `{ name, description, params? }`
2. …your graph… (`args` output carries the validated arguments)
3. `boundary.tool.return`: wire your result into `result`

A complete tool with validated params + an outbound call (this is
`tool-weather.json`, the archetype to copy):

```json
{
  "id": "tool-weather",
  "name": "Tool · get_weather",
  "nodes": [
    { "id": "in", "op": "boundary.tool", "config": { "name": "get_weather", "description": "Current weather for a city.", "params": { "type": "object", "properties": { "city": { "type": "string", "description": "City name, e.g. Paris" } }, "required": ["city"] } } },
    { "id": "url", "op": "core.string.template", "config": { "template": "https://wttr.in/{{city}}?format=3" } },
    { "id": "fetch", "op": "core.http.fetch", "config": { "responseType": "text" } },
    { "id": "out", "op": "boundary.tool.return" }
  ],
  "edges": [
    { "from": { "node": "in", "port": "args" }, "to": { "node": "url", "port": "data" } },
    { "from": { "node": "url", "port": "out" }, "to": { "node": "fetch", "port": "url" } },
    { "from": { "node": "fetch", "port": "body" }, "to": { "node": "out", "port": "result" } }
  ]
}
```

The engine validates `params` (JSON Schema) before the graph runs, so `args`
carries clean arguments. Restart (or deploy from the admin) and the agent sees it
immediately; the
pipeline's `agents.tools.workflows` node picks up every tool by default.
Set `"needsApproval": true` on the trigger config to gate it behind a human
Approve/Deny in the chat (HITL).

Adding your own REST routes or a custom frontend alongside the chat? The
bundled docs (`@pattern-js/mod-docs` → `/docs`) cover the discipline: *Designing
your API* (one workflow per action, ops stay HTTP-free, decompose inputs / keep
outputs whole) and *Create an app* (serving a built SPA via the app trio:
`boundary.http.app` → `core.app.static` → `boundary.http.app.serve`, assets
registered with `provideFilesystem`). No stack is imposed, but this chat app and
the admin are built with React, Tailwind, motion.dev (the `motion` package) and
lucide: a tested starting point if you have no preference.

### Tune the agent (instructions, model)

Open `/admin` → Workflows → `chat.turn.pipeline` → the `agents.agent` node:
its config carries `instructions` (the model comes from Settings → AI Providers,
or wire an `ai.model` node into the agent's `model` input). The built-in pipeline
is a code workflow; **fork it** (Editor → Fork), edit your copy, then disable the
built-in from the catalog (Status toggle). Your fork's route takes over.

### Add a guardrail

A guardrail is a tool workflow returning `{ tripwire: boolean, info? }`.
Wire it: add an `agents.guardrail` node (config: `tool` = the tool's name,
`direction`: input|output) and connect its `guardrail` output into the
`agents.agent` node's `guardrails` input. A tripped guardrail renders as an
inline card in the chat. Mark the tool's `boundary.tool`
config `guardrail: true` so it stays a guardrail and is never offered to the
model as a callable tool.

**Shipped by default:** a professional-conduct input guardrail
(`chat.guardrail.professional`) runs a small classifier on each message and
trips on subjects not appropriate at work. By default it uses the app's default
model; pin a cheaper one (and tune the prompt) via
`chatMod({ guardrail: { model: { provider, modelId }, instructions } })`. It's
wired into the turn pipeline unless `CHAT_GUARDRAIL=false` (see `.env`), or just
edit the `chat.guardrail.professional` workflow in the admin.

### Require sign-in to chat

By default guests chat anonymously (device-scoped conversations). To gate it:
add `"@pattern-js/mod-identity"` and `"@pattern-js/mod-auth-magic-link"` to the
mods in `pattern.config.json`, then set `CHAT_REQUIRE_AUTH=true` in `.env`
(or a comma-separated scope list, e.g. `CHAT_REQUIRE_AUTH=member`). Anonymous
visitors now get the chat's sign-in card (email → magic link, printed to the
console until delivery is wired — install `@pattern-js/mod-email` plus a driver
(`mod-email-resend` / `mod-email-smtp`) and create a `default` account in
admin → System → Email; links then send automatically). Unset the var to reopen.
Admin → Chat → Conversations shows every conversation either way, guests
included.

### Compact long conversations

Drop an `agents.history.compact` node between `chat.turn.begin`'s `history`
output and `agents.run`'s `history` input. Compaction is a visible node; you
SEE when memory squeezes.

## Hybrid execution

This project ships a small worker pool (`workers` in `pattern.config.json`), so
the admin's Process page reads **hybrid**. Set a workflow's `offload` flag
(editor → gear, or `"offload": true`) to run a compute-heavy flow on that pool
instead of the host event loop; remove the `workers` field to go back to inline.
The chat turn pipeline itself stays inline (it streams and holds a lease).

## Where things live

- `workflows/`: file workflows (tools, routes); editable, committed
- `./.pattern`: admin-versioned workflows (committed)
- `./.pattern-data`: sqlite + blobs (conversations, secrets); gitignored
- Chat data: admin → Data → Collections (`chat.conversations`, `chat.turns`)
