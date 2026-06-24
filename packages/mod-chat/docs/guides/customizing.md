---
title: Customizing the chat
order: 10
---

# Customizing the chat

The chat is a product app, but nothing about it is locked. Three levels of
customization, cheapest first.

## Level 1 — options (no fork)

```ts
chatMod({
  agent: { name: "Aria", instructions: "Be concise and warm.", model: { provider: "openai", modelId: "gpt-5" } },
  requireAuth: { env: "CHAT_REQUIRE_AUTH" },
  maxTurns: 12,
})
```

The no-fork knobs cover the common cases:

- `agent.{name,instructions,model}` — the built-in agent's persona and model.
  `model` is `{ routing?, provider, modelId }` (it wires an `ai.model` node);
  omit it to use the default model from admin → Settings → AI Providers.
- `guardrail` — the shipped professional-conduct input guardrail (`boolean`, or
  `{ enabled, model, instructions }`, where `model` is the same shape). On by
  default; the `CHAT_GUARDRAIL` env var is the runtime switch.
- `maxTurns` — model↔tool round-trips per turn (default 12).
- `turnTtlMs` — the running-turn lease TTL / crash backstop (default 5 min).
- `requireAuth`, `loginRequestPath`, `logoutPath` — who may chat and where
  sign-in posts.

**Reach for a fork when the change is structural, not a value:** a different
toolset per assistant, an extra node (compaction, RAG retrieval, an output
guardrail), or a rewired reliability path. Anything you can express as one of
the options above does NOT need a fork.

## Level 2 — fork the turn pipeline

Every message runs `chat.turn.pipeline`, a real workflow. In the admin:
**fork** it (Editor → Fork), edit your copy, disable the built-in from the
catalog. Its shape:

```
boundary.http.request → chat.turn.begin ─ok──→ core.flow.branch ─then→ agents.tools.workflows ─┐
                                          │                                                      ↓
                                          │                          agents.agent ←─ guardrails ─┤
                                          │                               │                       │
                                          │                          agents.run ──events──→ boundary.http.response (SSE)
                                          │                               └────────events──→ chat.events.sink
                                          └conflict──→ boundary.http.status → boundary.http.response (409)
```

`chat.turn.begin` (lease + turn doc) and `chat.events.sink` (persist + notify)
are the fixed bookends; the visible middle is yours:

- swap or wire the model on the `agents.agent` node,
- add `agents.guardrail` nodes (input/output safety) into the agent's
  `guardrails` port,
- insert `agents.history.compact` between the history read and `agents.run`,
- narrow the toolset — `agents.tools.workflows` offers every `boundary.tool`
  workflow by default; name them in its `tools` config to restrict.

Because the lease, the SSE response, and the persistence sink are all visible
nodes too, you can re-route reliability behavior — not just the agent. There's a
sibling `chat.approval.pipeline` (HITL resume) of the same shape; fork it too if
your changes affect the agent's reified shape.

## Level 3 — your own surface

The SPA consumes the turn-event protocol (`text.delta`, `tool.activity`,
`approval.request`, a terminal `done`) through a store abstraction — it never
touches the wire. A future voice/avatar surface plugs into the same store; the
protocol reserves `audio.ref` for that round.

## Reliability you inherit

The store is the source of truth, SSE is a live tail: every event lands in the
turn doc as it streams, every turn reaches a terminal status, refresh
mid-turn replays and re-attaches, errors render as inline cards. You don't
wire any of that — it's the pipeline's shape.
