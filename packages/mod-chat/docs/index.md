# Chat

`@pattern-js/mod-chat` is a complete, hosted chat application: a transcript-style
SPA over a lease-guarded, event-sourced turn pipeline.

## When to use it

Reach for `chatMod()` when you want a finished assistant product: a real SPA (the
strand rail shows tool calls live), conversations + a persisted per-turn event
log, lease-guarded turns with Stop, image input, sign-in / guests, HITL
approvals, and an admin "Conversations" surface, all wired. Brand it, point it at
an agent, host it many times.

**When not to:** if you only need the agent machinery (an agent loop, tools,
streaming) inside your own UI or endpoint, drop down to `@pattern-js/mod-agents`
and wire `agents.agent` / `agents.run` yourself. This mod is the whole app on top
of that; using it as a building block means fighting its SPA, routes, and turn
bookkeeping.

## Prerequisites

Install alongside, in your `pattern.config.json` mods:

- `@pattern-js/mod-store`: conversations, turn docs, blobs, and the per-turn
  lease all live here. `ready` throws without it.
- The agent stack: `@pattern-js/mod-agents` (the agent ops + run loop) plus
  `@pattern-js/mod-ai` (the model provider). Set a default model in admin →
  Settings → AI Providers and the provider key (e.g. `OPENAI_API_KEY`) in the
  vault; the shipped pipeline's `agents.run` then runs on it.

Optional but assumed by the defaults: `@pattern-js/mod-identity` +
`@pattern-js/mod-auth-magic-link` (for the sign-in card the SPA renders). Without
them, everyone is a guest, which is fine.

## Minimal config

```ts
import { chatMod } from "@pattern-js/mod-chat";

chatMod() // an assistant at /chat, guests allowed, the default agent
```

```ts
chatMod({
  agent: { name: "Aria", instructions: "Be concise and warm.", model: { provider: "openai", modelId: "gpt-5" } },
})
```

`agent.{name,instructions,model}` are the no-fork knobs (`model` is
`{ routing?, provider, modelId }`, or omit it for the default model); everything
else has a sensible default (see [Customizing](./guides/customizing.md)).

## Integration

The mod registers ONE shared backend (the `chat.*` ops, the CRUD + turn-pipeline
routes, the admin screens) and one or more branded SPA instances. Its routes
mount under `mount` (default `/chat`); the SPA's `apiBase` points at
`{mount}/api`. Auth and sign-in interoperate with `@pattern-js/mod-identity`'s
`user` port and magic-link mod. `requireAuth` defaults to
`{ env: "CHAT_REQUIRE_AUTH" }`, so the host reads the switch per request.

## The turn pipeline is a workflow

Every message runs `chat.turn.pipeline`, a real workflow whose interesting
middle (`agents.agent`, `agents.run`, tools, guardrails) is visible, editable
nodes. **Fork** it in the admin to swap models, add guardrails, insert
compaction, or narrow toolsets. The bookends `chat.turn.begin` and
`chat.events.sink` stay; you rewire the rest. See
[Customizing](./guides/customizing.md).

## The chat experience

Beyond the transcript, the SPA ships a polished UX with no configuration:

- **Voice mode.** A fullscreen, always-on voice conversation behind the wave
  button. An on-device neural VAD (Silero) detects when you finish speaking,
  transcribes, sends the turn, and speaks the reply back sentence by sentence;
  start talking again and it stops to listen (barge-in). A GPU particle avatar
  (custom WGSL, with a Canvas2D fallback) reacts to the audio, shows tool calls
  as glyphs, "paints" a generated image before dissolving it, and shifts color
  with the assistant's tone. It loads only when entered.
- **Model switcher.** Pick any language-model alias per turn from the header; the
  choice persists and applies to voice mode too. Backed by
  `GET {mount}/api/:ns/models` (alias names and display fields only, no secrets)
  and resolved per turn by `chat.model.resolve`, which fails soft to the
  configured pin or app default.
- **Theme.** A three-way light / dark / system toggle in the sidebar.
- **Smart dictation.** The composer mic uses the same VAD: speak, and it stops
  and transcribes itself, with a live waveform while listening.

Voice turns post with `avatar: true`, and the turn pipeline wires that flag (via
`core.value.select` → the agent's `instructions` input) into a spoken, emoji-rich
instruction style (short, conversational, no markdown) while normal text turns
keep the configured instructions. The avatar's color follows the reply's mood,
detected client-side from the streamed text (no model tool call needed).

## Memory (0.4) — it remembers you, with receipts

Install `@pattern-js/mod-vectors` and define an `embeddings` alias, and the
chat grows **cross-conversation, per-user memory** — no config, no new deps
(everything is duck-typed; without vectors, chat runs exactly as before).

After every completed turn, the `chat.memory.pipeline` workflow — an ordinary,
forkable graph triggered by the `chat.turn.completed` event — asks a model
whether the exchange taught it something durable about the user ("User's dog
is called Rex", "User prefers answers in French") and indexes each fact into
the `chat.memories` collection, keyed and **filter-pruned by user**: one
user's memories never rank against another's. On the next turn — in *any*
conversation — the pipeline's `chat.memory.recall` node retrieves the most
relevant memories into the system prompt.

The part nobody else has: **provenance**. Every memory carries
`{ userId, conversationId, sourceRunId }` — the exact run where it was
learned. Admin → Chat → **Memories** lists every fact with a **Source run**
link (watch the replay of the moment it was learned), a **Conversation**
link, and a **Forget** button. Memory here isn't a black box in a library —
it's a workflow you can open, an extraction prompt you can rewrite, and an
audit trail you can click.

Signed-in users only (guests have no durable identity). Turn it off with
`chatMod({ memory: false })`; tune the collection, alias, or recall depth via
the `memory` options object.

## Reliability model

The store is the source of truth; SSE is a live tail. Every event lands in the
turn doc as it streams, every turn reaches a terminal status (even a sink crash
records one), refresh mid-turn replays and re-attaches, and errors render as
inline cards, so the screen stays alive.

## Who may chat

Guests are device-scoped by default (a `chat_device` cookie). One switch gates
it: `CHAT_REQUIRE_AUTH=true` (or a comma-separated scope list). Every chat
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
