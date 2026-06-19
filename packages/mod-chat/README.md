# @pattern/mod-chat

A complete, hosted chat application for [Pattern](../../README.md) agents — a
transcript-style SPA over a lease-guarded, event-sourced turn pipeline. Brand it,
point it at an agent, host it many times.

```bash
npm install @pattern/mod-chat
```

## When to use

Reach for `chatMod()` when you want a finished assistant product, not a
primitive: a real SPA (the strand rail shows tool calls live), conversations + a
persisted per-turn event log, lease-guarded turns with Stop, image input, sign-in
/ guests, HITL approvals, and an admin "Conversations" surface — all wired.

**When not:** if you only need the agent machinery inside your own UI or endpoint,
drop down to `@pattern/mod-agents` and wire `agents.agent` / `agents.run`
yourself — this mod is the whole app on top of that, not a building block to
compose into another surface.

## Prerequisites

Add these alongside in `pattern.config.json`:

- **`@pattern/mod-store`** — conversations, turn docs, blobs, and the per-turn
  lease live here. `ready` throws without it.
- **`@pattern/mod-agents`** plus a model backend like
  **`@pattern/mod-agents-openai`**. The shipped pipeline's `agents.run` needs
  `OPENAI_API_KEY` (or wire `vault.read` → its `apiKey`).

Optional but assumed by the defaults: `@pattern/mod-identity` +
`@pattern/mod-auth-magic-link` for the sign-in card the SPA renders — without
them everyone is a guest, which is fine.

## Config

```ts
import { chatMod } from "@pattern/mod-chat";

chatMod() // an assistant at /chat, guests allowed, the default agent

chatMod({
  agent: { name: "Aria", instructions: "Be concise and warm.", model: "gpt-4o" },
})
```

`agent.{name,instructions,model}` are the no-fork knobs. Every message runs the
`chat.turn.pipeline` workflow — fork it in the admin to swap models, add
guardrails, or narrow toolsets.

Full documentation: the **Chat** chapter at `/docs` (served by
`@pattern/mod-docs`), or [the source](docs/index.md).
