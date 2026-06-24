# @pattern-js/mod-chat

A complete, hosted chat application for [Pattern](../../README.md) agents — a
transcript-style SPA over a lease-guarded, event-sourced turn pipeline. Brand it,
point it at an agent, host it many times.

```bash
npm install @pattern-js/mod-chat
```

## When to use

Reach for `chatMod()` when you want a finished assistant product, not a
primitive: a real SPA (the strand rail shows tool calls live), conversations + a
persisted per-turn event log, lease-guarded turns with Stop, image input, sign-in
/ guests, HITL approvals, and an admin "Conversations" surface — all wired.

**When not:** if you only need the agent machinery inside your own UI or endpoint,
drop down to `@pattern-js/mod-agents` and wire `agents.agent` / `agents.run`
yourself — this mod is the whole app on top of that, not a building block to
compose into another surface.

## Prerequisites

Add these alongside in `pattern.config.json`:

- **`@pattern-js/mod-store`** — conversations, turn docs, blobs, and the per-turn
  lease live here. `ready` throws without it.
- **`@pattern-js/mod-agents`** plus **`@pattern-js/mod-ai`** (the model provider).
  Set a default model in admin → Settings → AI Providers and the provider key
  (e.g. `OPENAI_API_KEY`) in the vault; the shipped pipeline's `agents.run` runs on it.

Optional but assumed by the defaults: `@pattern-js/mod-identity` +
`@pattern-js/mod-auth-magic-link` for the sign-in card the SPA renders — without
them everyone is a guest, which is fine.

## Config

```ts
import { chatMod } from "@pattern-js/mod-chat";

chatMod() // an assistant at /chat, guests allowed, the default agent

chatMod({
  agent: { name: "Aria", instructions: "Be concise and warm.", model: { provider: "openai", modelId: "gpt-5" } },
})
```

`agent.{name,instructions,model}` are the no-fork knobs (`model` is
`{ routing?, provider, modelId }`, or omit it for the default model from admin →
Settings → AI Providers). Every message runs the `chat.turn.pipeline` workflow —
fork it in the admin to swap models, add guardrails, or narrow toolsets.

Full documentation: the **Chat** chapter at `/docs` (served by
`@pattern-js/mod-docs`), or [the source](docs/index.md).
