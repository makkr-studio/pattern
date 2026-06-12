# Agent guide — {{name}} (Pattern · agent-chat modpack)

You are working in a **Pattern** project running a complete AI-agent chat:
`/chat` is a product chat app whose every turn executes a **workflow** —
`chat.turn.pipeline` — visible in the admin at `/admin`. The agent, its tools
and its guardrails are graph nodes. Your job is usually one of: add a tool,
tune the agent, add a guardrail, or rewire the pipeline. Recipes below.

## Ground rules

1. **Never guess op names or ports.** Ground truth is one command away:
   - `npx pattern ops agents` — the agent ops (agent, run, tools, guardrail…)
   - `npx pattern ops chat` — the chat pipeline ops
   - `npx pattern ops <type>` — full ports + config detail for any op
2. **Validate every workflow JSON you touch:** `npx pattern validate <file>`.
3. The agent needs an API key, resolved in order: explicit `apiKey` input →
   `OPENAI_API_KEY` in `.env` (copied from `.env.example`; loaded
   automatically, real env wins) → a vault secret NAMED `OPENAI_API_KEY`
   (admin → System → Secrets — no wiring needed; vault values are masked out
   of run samples). `PATTERN_VAULT_KEY` (the vault's master key) belongs in
   `.env`.
4. Don't edit `./.pattern` by hand; `./.pattern-data` is runtime data
   (conversations, blobs, secrets) and is gitignored.

## Mental model (60 seconds)

- A chat turn = `POST /chat/api/conversations/:id/turns` → the
  `chat.turn.pipeline` workflow: `chat.turn.begin` (scoping + a one-turn-
  at-a-time lease) → `agents.tools.workflows` → `agents.agent` →
  `agents.run` → SSE response + `chat.events.sink` (persists every event;
  the chat UI replays from the store on refresh).
- **A tool is a workflow** starting with `boundary.tool` (name, description,
  `params` as JSON Schema — engine-validated before your graph runs) and
  ending with `boundary.tool.return` ({ result }). Every call shows up in the
  admin Runs page as a linked sub-run (↳) with sampled I/O.
- Agents, toolsets and guardrails are **values on edges** — wire
  `agents.guardrail` or extra toolsets into the `agents.agent` node.

## Recipes

### Add a tool the agent can call

Create `workflows/tool-<name>.json` (see `tool-time.json` for the minimal
shape, `tool-weather.json` for validated params + an outbound HTTP call):

1. `boundary.tool` trigger — config `{ name, description, params? }`
2. …your graph… (`args` output carries the validated arguments)
3. `boundary.tool.return` — wire your result into `result`

Restart (or deploy from the admin) and the agent sees it immediately — the
pipeline's `agents.tools.workflows` node picks up every tool by default.
Set `"needsApproval": true` on the trigger config to gate it behind a human
Approve/Deny in the chat (HITL).

### Tune the agent (instructions, model)

Open `/admin` → Workflows → `chat.turn.pipeline` → the `agents.agent` node:
its config carries `instructions` and `model`. The built-in pipeline is a
code workflow — **fork it** (Editor → Fork), edit your copy, then disable the
built-in from the catalog (Status toggle). Your fork's route takes over.

### Add a guardrail

A guardrail is a tool workflow returning `{ tripwire: boolean, info? }`.
Wire it: add an `agents.guardrail` node (config: `tool` = the tool's name,
`direction`: input|output) and connect its `guardrail` output into the
`agents.agent` node's `guardrails` input. A tripped guardrail renders as an
inline card in the chat — never a crash.

### Compact long conversations

Drop an `agents.history.compact` node between `chat.turn.begin`'s `history`
output and `agents.run`'s `history` input. Compaction is a visible node — you
SEE when memory squeezes.

## Where things live

- `workflows/` — file workflows (tools, routes); editable, committed
- `./.pattern` — admin-versioned workflows (committed)
- `./.pattern-data` — sqlite + blobs (conversations, secrets); gitignored
- Chat data: admin → Data → Collections (`chat.conversations`, `chat.turns`)
