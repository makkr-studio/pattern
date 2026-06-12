# Chat

`@pattern/mod-chat` is the complete chat application at `/chat`: a
transcript-style SPA (the strand rail shows tool calls live), conversations
+ a persisted per-turn event log in mod-store, lease-guarded turns with Stop,
image input, sign-in / guests, and HITL approvals.

Needs `@pattern/mod-store` + an agents provider
(`@pattern/mod-agents` + `@pattern/mod-agents-openai`).

## The turn pipeline is a workflow

Every message runs `chat.turn.pipeline` — a real workflow you can **fork** in
the admin (then disable the built-in): swap models, add guardrails, insert
compaction, narrow toolsets. The interesting middle is visible nodes, not
framework internals. Common knobs without forking:
`chatMod({ agent: { instructions, model } })`.

## Reliability model

The store is the source of truth, SSE is a live tail: every event lands in
the turn doc as it streams, every turn reaches a terminal status, refresh
mid-turn replays and re-attaches. Errors render as inline cards — never a
white screen.

## Who may chat

Guests are device-scoped by default. One switch gates it:
`CHAT_REQUIRE_AUTH=true` (or a scope list) — every chat route follows it,
forks included; the app shows its own magic-link sign-in. Admin → **Chat →
Conversations** lists every conversation, guests included, with run
deep-links per turn.
