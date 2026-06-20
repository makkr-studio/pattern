# Agents (OpenAI provider)

`@pattern-js/mod-agents-openai` reifies the neutral agent descriptors with the
`@openai/agents` SDK: streaming runs, tools (workflow / MCP / op), guardrails,
handoffs, history compaction, human-in-the-loop approvals, and realtime key
minting (the voice round's foundation). `agents.agent` builds a plain-JSON
descriptor (no SDK work); `agents.run` reifies and runs it.

## When to use

Install this alongside `@pattern-js/mod-agents` (the contracts + registry —
required; the mod throws on startup without it) whenever your provider is
OpenAI, or anything `ModelProvider`-compatible. It owns the `agents.*` run
ops; the neutral mod owns the `boundary.tool` pair and toolset ops.

```jsonc
// pattern.config.json — provider needs the contracts
{ "mods": ["@pattern-js/mod-agents", "@pattern-js/mod-agents-openai"] }
```

**When not:** if you only need a one-shot completion with no tools, no agent
loop, and no streaming events, a plain model-call op is lighter. Reach for
this when there's an actual agent — tools, handoffs, a live transcript.

## Provider setup & the API key

`agents.run` (and `agents.run.resume`, `agents.history.compact`,
`agents.realtime.key`) resolve the key in this order:

1. an explicit `apiKey` **input** (wire `vault.read` or any value into it),
2. `OPENAI_API_KEY` from the **environment** — `loadProject` auto-loads a
   `.env` next to `pattern.config.json` (existing env always wins),
3. **a vault secret named `OPENAI_API_KEY`** (admin → System → Secrets).

Storing the key in the vault Just Works — no node to wire. Vault-read values
register into the engine's sample mask, so the key can never appear in
sampled run I/O. Missing key is a **pre-flight failure**: the node errors
loudly with a hint, rather than streaming a broken turn.

## Streaming runs

`agents.run` always streams internally and emits the neutral turn protocol on
its `events` port, while `output` / `history` / `stopReason` / `stateToken`
settle as values. Map the SDK stream once; fan it to many consumers (an SSE
response **and** a persistence sink). The stream **never rejects** and
**always** ends with `done` — mid-turn problems (rate limits, guardrail
trips, max-turns) become `error` events and a soft `error` outcome, because
errors are content a chat can render, not crashes.

History is **explicit**: pull it from a store node, pass it into `history`,
push the updated `history` output back. Agents and conversations are
different things — keeping items opaque lets the provider use its native
format losslessly. Input can be a plain string, a parts array
(`{ text | image_ref }` — image blobs resolve through `@pattern-js/mod-store`
into data URLs, so vision works local-first), or pre-shaped provider items.

## HITL approvals & resume

A tool marked `needsApproval` pauses the turn: `agents.run` emits an
`approval.request` carrying the pending call and an opaque `stateToken`, then
a terminal `done { stopReason: "interrupted" }`. To continue, feed that token
plus `decisions` (`[{ id, approved }]`) into `agents.run.resume` — it rebuilds
the run state and streams the **same** turn into the same event log. This is
exactly how the chat's Approve/Deny buttons drive the agent forward.

Note on cancellation: a streaming run settles for the engine before the SSE
tail finishes, so `engine.cancelRun` can't reach an in-flight turn. A Stop
button goes through the registry instead — `AGENTS_SERVICE.abortTurn(turnId)`
— which aborts the run and emits `done { stopReason: "cancelled" }`. Pass a
`turnId` into the run to address it.

## History compaction as a node

`agents.history.compact` squeezes a long history: when it exceeds `threshold`
items, everything older than `keepRecent` is summarized into one message and
the recent tail kept verbatim (it's a no-op below the threshold, with
`compacted: false`). It's a **visible node** — drop it between your store's
history output and `agents.run`'s `history` input and you SEE exactly when
memory compresses, and can swap the summarizer `model`.

## MCP servers — forgiving stdio command

`agents.mcp.server` turns an MCP server into a toolset value (connections are
pooled per process, keyed by the descriptor). For **stdio**, the `command`
field is forgiving: paste a whole command line verbatim — e.g. a Docker
Desktop gateway line `docker mcp gateway run --profile X` — and leave `args`
empty. It's tokenized automatically (quotes honored), extra tokens become
leading args, explicit `args` are appended, and stray trailing spaces or
blank args are trimmed so they can't `ENOENT`. See the MCP servers guide.

## Integration

- **`@pattern-js/mod-agents`** — required; this mod meets it at the
  `AGENTS_SERVICE` seam (tool registry, turn-abort, op tools).
- **`@pattern-js/mod-store`** — image parts resolve blob ids through its blob
  service (duck-typed, no hard dependency).
- **`@pattern-js/mod-vault`** — the `OPENAI_API_KEY` secret source.
- **`MODEL_PROVIDER_SERVICE`** — a test/swap seam: provide a scripted
  `ModelProvider` and the whole stack runs without an API key (the agent-chat
  demo does this; you could also swap in any compatible backend).
