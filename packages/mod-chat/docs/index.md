# Chat

`@pattern-js/mod-chat` is a complete, hosted chat application — a transcript-style
SPA over a lease-guarded, event-sourced turn pipeline.

## When to use it

Reach for `chatMod()` when you want a finished assistant product, not a
primitive: a real SPA (the strand rail shows tool calls live), conversations +
a persisted per-turn event log, lease-guarded turns with Stop, image input,
sign-in / guests, HITL approvals, and an admin "Conversations" surface — all
wired. Brand it, point it at an agent, host it many times.

**When not to:** if you only need the agent machinery (an agent loop, tools,
streaming) inside your own UI or endpoint, drop down to `@pattern-js/mod-agents`
and wire `agents.agent` / `agents.run` yourself — this mod is the whole app on
top of that, and you'd be fighting its SPA, routes, and turn bookkeeping. It is
not a building block to compose into another surface.

## Prerequisites

Install alongside, in your `pattern.config.json` mods:

- `@pattern-js/mod-store` — conversations, turn docs, blobs, and the per-turn
  lease all live here. `ready` throws without it.
- The agent stack — `@pattern-js/mod-agents` (the agent ops + run loop) plus
  `@pattern-js/mod-ai` (the model provider). Set a default model in admin →
  Settings → AI Providers and the provider key (e.g. `OPENAI_API_KEY`) in the
  vault; the shipped pipeline's `agents.run` then runs on it.

Optional but assumed by the defaults: `@pattern-js/mod-identity` +
`@pattern-js/mod-auth-magic-link` (for the sign-in card the SPA renders) — without
them, everyone is a guest, which is fine.

## Minimal config

```ts
import { chatMod } from "@pattern-js/mod-chat";

chatMod() // an assistant at /chat, guests allowed, the default agent
```

```ts
chatMod({
  agent: { name: "Aria", instructions: "Be concise and warm.", model: "gpt-4o" },
})
```

`agent.{name,instructions,model}` are the no-fork knobs; everything else has a
sensible default (see [Customizing](./guides/customizing.md)).

## Integration

The mod registers ONE shared backend (the `chat.*` ops, the CRUD + turn-pipeline
routes, the admin screens) and one or more branded SPA instances. Its routes
mount under `mount` (default `/chat`); the SPA's `apiBase` points at
`{mount}/api`. Auth and sign-in interoperate with `@pattern-js/mod-identity`'s
`user` port and magic-link mod — `requireAuth` defaults to
`{ env: "CHAT_REQUIRE_AUTH" }`, so the host reads the switch per request.

## The turn pipeline is a workflow

Every message runs `chat.turn.pipeline` — a real workflow whose interesting
middle (`agents.agent`, `agents.run`, tools, guardrails) is visible, editable
nodes. **Fork** it in the admin to swap models, add guardrails, insert
compaction, or narrow toolsets. The bookends `chat.turn.begin` and
`chat.events.sink` stay; you rewire the rest. See
[Customizing](./guides/customizing.md).

## Reliability model

The store is the source of truth; SSE is a live tail. Every event lands in the
turn doc as it streams, every turn reaches a terminal status (even a sink crash
records one), refresh mid-turn replays and re-attaches, and errors render as
inline cards — never a white screen.

## Who may chat

Guests are device-scoped by default (a `chat_device` cookie). One switch gates
it: `CHAT_REQUIRE_AUTH=true` (or a comma-separated scope list) — every chat
route follows it, forks included, and the app shows its own magic-link sign-in.
Admin → **Chat → Conversations** lists every conversation, guests included, with
run deep-links per turn.

## Worked example: a branded sales + support desk

```ts
chatMod({
  instances: [
    {
      mount: "/sales",
      namespace: "sales",
      brand: { accent: "#d2691e", title: "Pattern Sales" },
      agent: { name: "sales", instructions: "Upbeat sales assistant. Lead with value." },
    },
    { mount: "/support", namespace: "support", brand: { accent: "#2563eb", title: "Pattern Support" } },
  ],
})
```

Two branded SPAs over one backend, each with its own conversation list; `/sales`
gets a namespace-pinned pipeline fork running the sales agent while `/support`
falls back to the generic one. See
[Hosting several branded instances](./guides/multiple-instances.md).
