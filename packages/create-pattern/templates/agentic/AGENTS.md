# Agent guide — {{name}} (Pattern · Studio + Agents modpack)

You are working in a **Pattern** project for building **agentic workflows**: a
graph wires an agent (`agents.agent`) into a runner (`agents.run`), with tools
that are themselves workflows. The visual admin at `/admin` is the editor + run
tracer. There is no chat product here — agents run as workflows (from a route,
the editor, a schedule, or another workflow). Your job is usually: build an
agentic workflow, add a tool, add a guardrail, or expose a run over HTTP.

## Ground rules

1. **Never guess op names or ports.** Ground truth is one command away:
   - `npx pattern ops agents` — the agent ops (agent, run, tools, guardrail…)
   - `npx pattern ops agents.run` — full ports + config for any op
   - `npx pattern ops` — every op (core + this project's mods)
2. **Validate every workflow JSON you touch:** `npx pattern validate <file>`,
   and `npx pattern graph <file>` to see the graph in the terminal.
3. The agent needs a **model** and a **key**. Pick the model with an `ai.model`
   node wired into `agents.agent.model` (config `{ routing, provider, modelId }`),
   or set a default in admin → Settings → AI Providers and skip the node. The
   provider key resolves by name: `OPENAI_API_KEY` in the environment (`.env` is
   loaded on boot, real env wins) → a vault secret of that name (admin → System →
   Secrets — masked out of run samples). Gateway routing uses one
   `AI_GATEWAY_API_KEY` instead. `PATTERN_VAULT_KEY` (the vault master key) lives
   in `.env`.
4. Don't edit `./.pattern` by hand (admin-versioned workflows, committed);
   `./.pattern-data` is runtime data (sqlite, blobs, secrets) and is gitignored.

## The agent stack (60 seconds)

- **`ai.model`** (from `@pattern-js/mod-ai`) — config `{ routing (direct|gateway),
  provider, modelId }`; output `model` is a *value*. Wire it into
  `agents.agent.model`. Direct uses the provider's key from the vault/env; gateway
  uses one `AI_GATEWAY_API_KEY`. Skip it to fall back to the default model set in
  admin → Settings → AI Providers.
- **`agents.agent`** — config `{ name, instructions }`; inputs `model` (a ModelRef
  from `ai.model`), `tools` (a toolset), `guardrails`, `handoffs`. Output `agent`
  is a *value* you wire onward — it doesn't run anything by itself.
- **`agents.run`** — inputs `agent` (required) + `input` (required) + optional
  `history`. Outputs an `events` **stream**, the final `output`, the updated
  `history`, and a `stopReason`. Tool calls are linked sub-runs.
- **`agents.tools.workflows`** — collects every `boundary.tool` workflow into a
  `toolset` (config `tools: []` = all; name some to narrow). Wire `toolset` →
  `agents.agent.tools`.
- **A tool is a workflow** starting with `boundary.tool` (name, description,
  optional JSON-Schema `params` the engine validates) and ending with
  `boundary.tool.return` ({ result }). Drop it in `workflows/` and the agent
  discovers it.

## Recipes

### Build an agentic workflow

See `workflows/agent-answer.json`. The minimal shape, expose-over-HTTP:

```
boundary.http.request → core.object.get (the prompt field) ┐
agents.tools.workflows → agents.agent → agents.run → boundary.http.response
```

The full shape, as JSON (this is `workflows/agent-answer.json` — the archetype to
copy; verify ports with `npx pattern ops agents.run`):

```json
{
  "id": "agent-answer",
  "name": "POST /ask — agent answers (with a tool)",
  "nodes": [
    { "id": "in", "op": "boundary.http.request", "config": { "method": "POST", "path": "/ask" } },
    { "id": "question", "op": "core.object.get", "config": { "path": "question" } },
    { "id": "tools", "op": "agents.tools.workflows" },
    { "id": "model", "op": "ai.model", "config": { "routing": "direct", "provider": "openai", "modelId": "gpt-5-mini" } },
    { "id": "agent", "op": "agents.agent", "config": { "name": "assistant", "instructions": "Be concise. Use a tool when it helps." } },
    { "id": "run", "op": "agents.run" },
    { "id": "out", "op": "boundary.http.response" }
  ],
  "edges": [
    { "from": { "node": "in", "port": "body" }, "to": { "node": "question", "port": "object" } },
    { "from": { "node": "tools", "port": "toolset" }, "to": { "node": "agent", "port": "tools" } },
    { "from": { "node": "model", "port": "model" }, "to": { "node": "agent", "port": "model" } },
    { "from": { "node": "agent", "port": "agent" }, "to": { "node": "run", "port": "agent" } },
    { "from": { "node": "question", "port": "out" }, "to": { "node": "run", "port": "input" } },
    { "from": { "node": "run", "port": "output" }, "to": { "node": "out", "port": "body" } }
  ]
}
```

Keep the HTTP concerns on the boundary (method/path/validation/auth); wire the
extracted prompt into `agents.run.input` and `agents.run.output` into the
response body. Want it editor/CLI-only instead of HTTP? Swap the
`boundary.http.request`/`response` pair for `boundary.manual`/`boundary.return`
and run it from the admin's Runs view or `engine.run("<id>", { input })`.

### Add a tool the agent can call

Create `workflows/tool-<name>.json`: `boundary.tool` (config `{ name,
description, params? }`) → your graph → `boundary.tool.return` (wire your value
into `result`). The agent picks it up via `agents.tools.workflows`. Set
`"needsApproval": true` on the trigger to gate the call behind a human decision
(HITL) — resume with `agents.run.resume`.

### Add a guardrail

A guardrail is a tool workflow returning `{ tripwire: boolean, info? }`. Add an
`agents.guardrail` node (config `tool` = the tool's name, `direction`:
input|output) and wire its `guardrail` output into `agents.agent.guardrails`.
Mark the tool's `boundary.tool` config `guardrail: true` so it stays a guardrail
and is never offered to the model as a callable tool.

### Stream the run

`agents.run.events` is a stream — wire it into a `boundary.http.response`
`stream` port with `mode: "sse"` to stream tokens, or into a persistence sink.
Tee it with `core.stream.split` to do both at once.

### Generate media in a tool

`@pattern-js/mod-ai` ships capability ops beyond text: `ai.image.generate`,
`ai.speech.generate`, `ai.video.generate`. They output **raw media**
(`{ bytes, mime }`) and **don't save** — wire the output into `store.blob.put`
(its `ref` output is a `MediaRef` served at `/store/blobs/:id`) when you want to
keep it. Resolve a matching alias (`image`, `speech`, …) with `ai.alias`.

## Serve a custom frontend

A standalone user-facing SPA is just a workflow: register your built assets as a
named filesystem in a mod's `setup` (`provideFilesystem(engine, "my-app",
localFs("./app/dist"))`), then declare the app trio `boundary.http.app` →
`core.app.static` (`filesystem: "my-app"`, `spaFallback: "index.html"`) →
`boundary.http.app.serve`. `filesystem` is the registered **name**, not a path;
the app resolves once at registration (rebuilt SPA → restart; in dev run Vite and
proxy `/api` + `/auth`). No stack is imposed, but the admin is built with React,
Tailwind, motion.dev (the `motion` package) and lucide — a tested starting point
if you have no preference.

## Hybrid execution

This project ships a small worker pool (`workers` in `pattern.config.json`), so
the admin's Process page reads **hybrid**. Set a workflow's `offload` flag
(editor → gear, or `"offload": true`) to run a compute-heavy flow on that pool
instead of the host event loop; remove the `workers` field to go back to inline.

## Where things live

- `workflows/` — file workflows (agentic flows, tools); editable, committed
- `./.pattern` — admin-versioned workflows (committed)
- `./.pattern-data` — sqlite + blobs (conversations, secrets); gitignored
