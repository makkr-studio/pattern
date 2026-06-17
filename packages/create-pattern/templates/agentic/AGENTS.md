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
3. The agent needs an API key, resolved in order: an `apiKey` input →
   `OPENAI_API_KEY` in the environment (`.env` is loaded on boot, real env
   wins) → a vault secret NAMED `OPENAI_API_KEY` (admin → System → Secrets — no
   wiring; vault values are masked out of run samples). `PATTERN_VAULT_KEY`
   (the vault master key) lives in `.env`.
4. Don't edit `./.pattern` by hand (admin-versioned workflows, committed);
   `./.pattern-data` is runtime data (sqlite, blobs, secrets) and is gitignored.

## The agent stack (60 seconds)

- **`agents.agent`** — config `{ name, instructions, model? }`; inputs `tools`
  (a toolset), `guardrails`, `handoffs`. Output `agent` is a *value* you wire
  onward — it doesn't run anything by itself.
- **`agents.run`** — inputs `agent` (required) + `input` (required) + optional
  `history`/`apiKey`. Outputs an `events` **stream**, the final `output`, the
  updated `history`, and a `stopReason`. Tool calls are linked sub-runs.
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

## Where things live

- `workflows/` — file workflows (agentic flows, tools); editable, committed
- `./.pattern` — admin-versioned workflows (committed)
- `./.pattern-data` — sqlite + blobs (conversations, secrets); gitignored
