---
title: Customizing the chat
order: 10
---

# Customizing the chat

The chat is a product app, but nothing about it is locked. Three levels of
customization, cheapest first.

## Level 1 — options

```ts
chatMod({
  agent: { name: "Aria", instructions: "Be concise and warm.", model: "gpt-4o" },
  requireAuth: { env: "CHAT_REQUIRE_AUTH" },
  maxTurns: 12,
})
```

Covers the common knobs without touching a workflow.

## Level 2 — fork the turn pipeline

Every message runs `chat.turn.pipeline`, a real workflow. In the admin:
**fork** it (Editor → Fork), edit your copy, disable the built-in from the
catalog. Now the middle is yours — the visible nodes between `chat.turn.begin`
and the response:

- swap or wire the model on the `agents.agent` node,
- add `agents.guardrail` nodes (input/output safety),
- insert `agents.history.compact` between the history read and `agents.run`,
- narrow the toolset (`agents.tools.workflows` config) per assistant.

Because the lease, the SSE response, and the persistence sink are all visible
nodes too, you can re-route reliability behavior — not just the agent.

## Level 3 — your own surface

The SPA consumes the turn-event protocol (`text.delta`, `tool.activity`,
`approval.request`, a terminal `done`) through a store abstraction — it never
touches the wire. A future voice/avatar surface plugs into the same store.
The protocol reserves `audio.ref` and `agents.realtime.key` is already there.

## Reliability you inherit

The store is the source of truth, SSE is a live tail: every event lands in the
turn doc as it streams, every turn reaches a terminal status, refresh
mid-turn replays and re-attaches, errors render as inline cards. You don't
wire any of that — it's the pipeline's shape.
