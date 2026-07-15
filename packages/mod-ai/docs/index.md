# AI capabilities (`@pattern-js/mod-ai`)

The capability layer. It gives your workflows **text, structured output,
embeddings, image, speech (TTS), transcription (STT), and video** generation
across **any provider**, directly or through the Vercel AI Gateway. It is the
**model provider** that powers `@pattern-js/mod-agents` (agents call models
through it). It is the only mod that imports the [Vercel AI SDK](https://ai-sdk.dev),
so every provider quirk, streaming detail, and the MCP client live behind one
seam you never have to touch.

Install it alongside `@pattern-js/mod-agents` (for agents) and, to persist
generated media, `@pattern-js/mod-store` (wire a generation op into its
`store.blob.put`; the ops themselves stay storage-agnostic). Provider keys live
in `@pattern-js/mod-vault`.

## Two ways to pick a model

Every capability op (and every agent) takes a **model reference**: a value, like
the agent value `agents.agent` builds. Two ops produce one.

**`ai.model`** defines a model inline. Routing is explicit and first-class:

| Routing | What it is | Model id |
|---|---|---|
| `direct` | a native provider SDK + that provider's key | bare, e.g. `gpt-5` |
| `gateway` | the **Vercel AI Gateway**: one key, hundreds of models, BYOK | `provider/model`, e.g. `openai/gpt-5` |

```json
{ "id": "model", "op": "ai.model",
  "config": { "routing": "direct", "provider": "openai", "modelId": "gpt-5" } }
```

**`ai.alias`** resolves a model configured in Settings by name:

```json
{ "id": "model", "op": "ai.alias", "config": { "alias": "default" } }
```

Either way, wire `model.model` → any `ai.*` op's `model` input or
`agents.agent.model`. Skip the node entirely and agents/chat fall back to the
**`default`** alias.

## Aliases

An **alias** is one self-contained, named model handle (managed in admin →
Settings → **AI Providers**): a provider, a model id, the secret(s) it
authenticates with, and any structured options. Each secret is sourced
explicitly, from the **vault** or an **env var**, so nothing relies on guessing a
provider's magic env-var name. A single-key provider needs only `apiKey`; Azure
adds a `resourceName`, Bedrock a `region` + AWS keys, Vertex a project/location +
a service-account secret. Two aliases of the same provider with different
credentials are simply two records.

`ai.alias` resolves an alias to a model **at run time**, so re-pointing `default`
from GPT-5 to Claude in Settings instantly re-targets every workflow and agent
using it, with no graph edits. Agents and chat fall back to the `default` alias
when no model is wired.

Provider **keys** live in the vault (admin → System → **Secrets**) or in env
vars; an alias just references them by name and source.

## The modality ops

All take a `model` (required) and write their result on named outputs. Text-ish
ops accept `prompt` XOR `messages` plus an optional `system`. The generation ops
(image/audio/video) output **raw media** (`{ bytes, mime, kind }`) and **don't
save**: keeping the save out of the op means mod-ai never assumes a blob store.
Wire the output into `store.blob.put` to persist it: its `ref` output is a
**`MediaRef`** (`{ blobId, mime }`) served at `GET /store/blobs/:id`. (One node:
`ai.image.generate.image → store.blob.put.data`, then `store.blob.put.ref` onward.)

| Op | Out | Notes |
|---|---|---|
| `ai.text.generate` | `text`, `usage`, `finishReason` | one-shot |
| `ai.text.stream` | `textStream` (stream), `text`, `usage` | tokens flow live, `text` settles |
| `ai.object.generate` | `object`, `usage` | give a JSON-Schema `schema` |
| `ai.object.stream` | `partialStream` (stream), `object` | partials as they complete |
| `ai.embed` / `ai.embed.many` | `embedding(s)`, `usage` | use an `embedding` model |
| `ai.image.generate` | `image`/`images` (raw media), `progress` | persist with `store.blob.put`; `n`, `size`, `aspectRatio`, `seed` |
| `ai.speech.generate` | `audio` (raw media) | persist with `store.blob.put`; `voice`, `speed` |
| `ai.transcribe` | `text`, `segments`, `language`, `durationMs` | pass a MediaRef or raw bytes |
| `ai.video.generate` | `video`/`videos` (raw media), `progress` | persist with `store.blob.put`; long-running (minutes); gateway-first |

**Long-running generation** (image, video): the op returns immediately with a
`progress` **stream** (`start` → `done`) and settles the media when ready,
and it honors `ctx.signal` so editor Stop / cancel aborts it. Video forces an
extended 15-minute fetch timeout (it routinely takes minutes).

Verify exact ports any time: `npx pattern ops ai.image.generate`.

## Powering agents

`mod-ai` provides the neutral model service `@pattern-js/mod-agents` calls. So an
agent is provider-agnostic: wire an `ai.model` into `agents.agent.model` (or rely
on the default), and `agents.run` works against OpenAI, Anthropic, Google, a
gateway model, anything.

## Usage accounting

Every language-model call — a plain `ai.text.generate`, an agent step, a chat
turn, a history compaction — reports its token usage from ONE seam: the
provider service taps the model itself, so nothing escapes the count. Each
call lands `ai.inputTokens` / `ai.outputTokens` / `ai.totalTokens` on its node
span (visible in the run waterfall) and emits an **`ai.usage`** event on the
bus: `{ modelId, inputTokens, outputTokens, totalTokens, userId?, runId,
workflowId, nodeId }` — `userId` present only for a signed-in caller.
Subscribe with a `boundary.event` workflow to build quotas, dashboards, or
billing (mod-billing ships that workflow ready-made). The agent loop also sums
its steps: `agents.run` now outputs `usage`, and the terminal `done` turn
event carries the same total. Accounting is fail-open telemetry — a metering
hiccup never breaks a generation.

## MCP: both directions

**Consume MCP servers** (client): `agents.mcp.client` (in mod-agents) builds a
toolset from an MCP server; `mod-ai` connects to it with the official MCP SDK
(http StreamableHTTP or stdio, pooled) so the agent can call its tools.

**Be an MCP server** (server): `mod-ai` mounts **`POST /mcp`**: a stateless
StreamableHTTP JSON-RPC endpoint that exposes your `boundary.tool` workflows to
external MCP clients (Claude Desktop, other agents). `tools/list` reads the tool
registry; `tools/call` runs the tool workflow via `ctx.invoke`, a linked
sub-run with the same validation + tracing as an agent's own tool call. Narrow
which tools are exposed by building your own route around `ai.mcp.serve`
(`config.tools`) — `tools/call` enforces the same exposure set, so narrowing
is a boundary, not a menu.

**Auth posture** (0.4): the default `/mcp` route is **public** — the
local-dev posture; gate it with `mcpServerWorkflow({ auth: { scopes: […] } })`
or by forking the route and setting `requireAuth`. Tools marked
`restricted: true` (the `pattern_*` control plane) never ride a `["*"]`
wildcard — here or in agent toolsets — and are served only when named
explicitly, the way mod-buddy's token-gated `/mcp/pattern` route does. For
local editors, `pattern mcp` serves the same tools over stdio, no tokens
(your shell already owns the box).

## Providers

mod-ai **bundles no provider**. The Vercel AI Gateway ships inside `ai`, so it
always works with one key and `provider/model` ids. Every **direct** provider is
an optional peer that mod-ai lazy-loads only when an alias uses it; add the
matching package to turn one on:

```bash
npm i @ai-sdk/anthropic        # then point an alias at the "anthropic" provider
```

The full first-party AI SDK catalog is supported (OpenAI, Anthropic, Azure,
Bedrock, Vertex, xAI, Groq, Mistral, Google, Together, Cohere, Fireworks,
DeepSeek, Perplexity, Fal, Luma, ElevenLabs, Deepgram, and many more, plus an
OpenAI-compatible provider for any other endpoint). `npm create pattern` offers a
provider multi-select when a modpack uses mod-ai, so a scaffold installs exactly
the ones you pick. The gateway needs no package.

## Settings

Admin → Settings → **AI Providers** manages your **aliases**: pick a provider
(which surfaces exactly the secret + option fields it needs), source each secret
from the vault or an env var, set the model id, and run a **Test** check. It also
browses the model catalog (curated suggestions plus the live gateway listing when
a gateway key is set).
