# Agents & Chat

Five mods turn Pattern into an AI-agent platform where the agent, its tools
and its guardrails are **workflow nodes you can see**:

| mod | what it brings |
| --- | --- |
| `@pattern/mod-store` | Generic persistence: JSON document collections with declared indexes, a blob store, TTL'd CAS **leases**. SQLite (`./.pattern-data/store.db`) or memory; admin Data browser. |
| `@pattern/mod-vault` | Encrypted secrets (AES-256-GCM, master key from `PATTERN_VAULT_KEY`). `vault.read` emits values that are **masked out of run samples**. Write-only Secrets admin page. |
| `@pattern/mod-agents` | The neutral contracts: agent/toolset/guardrail **descriptors** (plain JSON on edges), the **turn event protocol**, the `boundary.tool` pair, the live tool registry. No SDK dependency. |
| `@pattern/mod-agents-openai` | The OpenAI Agents SDK provider: `agents.agent`, `agents.run` (streaming, always), `agents.run.resume` (HITL), `agents.mcp.server`, `agents.history.compact`, `agents.realtime.key`. |
| `@pattern/mod-chat` | The product chat app at `/chat` — streaming transcript with the **strand**, tool buds, image input, approvals, Stop — whose turn pipeline IS a workflow. |

Fastest start: `npm create pattern@latest -- --modpack agent-chat`.

## Tools are workflows

```jsonc
// workflows/tool-weather.json
{ "id": "tool-weather",
  "nodes": [
    { "id": "in", "op": "boundary.tool",
      "config": { "name": "get_weather", "description": "Weather for a city",
                  "params": { "type": "object", "properties": { "city": { "type": "string" } }, "required": ["city"] } } },
    { "id": "...", "op": "…your graph…" },
    { "id": "out", "op": "boundary.tool.return" } ] }
```

- `params` is JSON Schema (the editor shows the visual SchemaBuilder). The
  **engine** validates every call's arguments at the trigger — a model's
  hallucinated args never reach your graph (`TriggerInputError`).
- Every call executes via `ctx.invoke`: a **linked sub-run** with sampled
  I/O — open the Runs page and the agent's work is a tree (↳).
- `needsApproval: true` on the trigger pauses the turn for a human
  Approve/Deny (HITL): the run state serializes into the turn doc and the
  approval resumes it exactly where it stopped.
- Three tool origins merge into one toolset: `boundary.tool` workflows
  (`agents.tools.workflows`), MCP servers (`agents.mcp.server` — connections
  pooled for the process), and mod-contributed code tools
  (`AGENTS_SERVICE.registerOpTool`, picked by `agents.tools.ops`).

## The turn event protocol

`agents.run` emits one stream every consumer speaks — SSE responses, the
chat's persisted log, future voice surfaces: `text.delta`, `text.done`,
`tool.activity` (start/done/error + sub-run link), `approval.request`
(+ opaque `stateToken`), `error` (errors are turn CONTENT — chats render
cards, not crashes), `audio.ref` (reserved), and a **guaranteed terminal**
`done {stopReason: complete|interrupted|error|cancelled}`.

## Conversations are yours, not the SDK's

History is pulled from the store, handed to `agents.run`, and the updated
history is pushed back — explicit nodes on the canvas. Compaction is a node
too (`agents.history.compact`): you SEE when memory squeezes. The chat mod's
turn doc persists every event as it streams: **the store is the source of
truth, SSE is a live tail** — a refresh mid-turn replays from the store, and
every turn reaches a terminal status even across crashes (lease TTL).

## One turn at a time

`chat.turn.begin` claims a CAS **lease** on the conversation (owner = the
turn); a concurrent send gets a 409 with the active turn and the UI offers
Stop. Streaming runs settle for the engine while the SSE tail still flows, so
Stop goes through the provider's **turn-abort registry**
(`AGENTS_SERVICE.abortTurn(turnId)`) rather than `engine.cancelRun`; the sink
releases the lease at the terminal event.

## API keys

`agents.run` resolves its key in order: an explicit `apiKey` input →
`OPENAI_API_KEY` from the environment (`loadProject` auto-loads a `.env`
file next to `pattern.config.json`; existing env always wins — that's also
where `PATTERN_VAULT_KEY` lives) → **a vault secret named `OPENAI_API_KEY`**
(admin → System → Secrets) — storing it in the vault Just Works, no wiring.
Vault-read values register into the engine's sample mask either way, so the
key can never appear in sampled run I/O.

## Customizing the chat pipeline

`chat.turn.pipeline` ships as a code workflow. To rewire it: **fork** it in
the admin editor, edit your copy (instructions and model live on the
`agents.agent` node; add `agents.guardrail` nodes, compaction, more
toolsets), then disable the built-in from the catalog. Or configure the
common knobs without forking: `chatMod({ agent: { instructions, model } })`.

## Voice (pre-wired, future round)

The protocol reserves `audio.ref`, `agents.realtime.key` mints ephemeral
client secrets for browser↔OpenAI realtime sessions, and the chat UI's
surfaces consume the store's event feed — a voice/avatar surface plugs in
without touching the wire.
