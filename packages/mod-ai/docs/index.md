# AI capabilities (`@pattern-js/mod-ai`)

The capability layer. It gives your workflows **text, structured output,
embeddings, image, speech (TTS), transcription (STT), and video** generation
across **any provider** — directly or through the Vercel AI Gateway — and it is
the **model provider** that powers `@pattern-js/mod-agents` (agents call models
through it). It is the only mod that imports the [Vercel AI SDK](https://ai-sdk.dev),
so every provider quirk, streaming detail, and the MCP client live behind one
seam you never have to touch.

Install it alongside `@pattern-js/mod-agents` (for agents) and, for generated
media, `@pattern-js/mod-store` (bytes land in its blob store). Provider keys live
in `@pattern-js/mod-vault`.

## Pick a model: `ai.model`

Every capability op (and every agent) takes a **model reference** — a value you
build with `ai.model` and wire onward, exactly like `agents.agent` builds an
agent value. Routing is **explicit and first-class**:

| Routing | What it is | The key | Model id |
|---|---|---|---|
| `direct` | a native provider SDK (`@ai-sdk/openai`, `anthropic`, `google`, `mistral`, `groq`) | the provider's key (e.g. `OPENAI_API_KEY`) | bare, e.g. `gpt-5` |
| `gateway` | the **Vercel AI Gateway** — one key, hundreds of models, BYOK | `AI_GATEWAY_API_KEY` | `provider/model`, e.g. `openai/gpt-5` |

```json
{ "id": "model", "op": "ai.model",
  "config": { "routing": "direct", "provider": "openai", "modelId": "gpt-5" } }
```

Wire `model.model` → any `ai.*` op's `model` input, or into `agents.agent.model`.
The key resolves by name: an explicit `credential`, then the env, then a vault
secret of that name (masked out of run samples). Set a **default model** in admin
→ Settings → **AI Providers** and you can skip the node entirely — agents/chat
fall back to it.

## The modality ops

All take a `model` (required) and write their result on named outputs. Text-ish
ops accept `prompt` XOR `messages` plus an optional `system`. Generated media
(image/audio/video) lands in the blob store and comes back as a **`MediaRef`**
(`{ blobId, mime }`), served at `GET /store/blobs/:id` — never base64 on a port.

| Op | Out | Notes |
|---|---|---|
| `ai.text.generate` | `text`, `usage`, `finishReason` | one-shot |
| `ai.text.stream` | `textStream` (stream), `text`, `usage` | tokens flow live, `text` settles |
| `ai.object.generate` | `object`, `usage` | give a JSON-Schema `schema` |
| `ai.object.stream` | `partialStream` (stream), `object` | partials as they complete |
| `ai.embed` / `ai.embed.many` | `embedding(s)`, `usage` | use an `embedding` model |
| `ai.image.generate` | `image`/`images` (MediaRef), `progress` | `n`, `size`, `aspectRatio`, `seed` |
| `ai.speech.generate` | `audio` (MediaRef) | `voice`, `speed` |
| `ai.transcribe` | `text`, `segments`, `language`, `durationMs` | pass a MediaRef or raw bytes |
| `ai.video.generate` | `video`/`videos` (MediaRef), `progress` | long-running (minutes); gateway-first |

**Long-running generation** (image, video): the op returns immediately with a
`progress` **stream** (`start` → `done`) and settles the `MediaRef` when ready,
and it honors `ctx.signal` so editor Stop / cancel aborts it. Video forces an
extended 15-minute fetch timeout (it routinely takes minutes).

Verify exact ports any time: `npx pattern ops ai.image.generate`.

## Powering agents

`mod-ai` provides the neutral model service `@pattern-js/mod-agents` calls. So an
agent is provider-agnostic: wire an `ai.model` into `agents.agent.model` (or rely
on the default), and `agents.run` works against OpenAI, Anthropic, Google, a
gateway model, anything. There is no per-provider agents mod anymore.

## MCP — both directions

**Consume MCP servers** (client): `agents.mcp.server` (in mod-agents) builds a
toolset from an MCP server; `mod-ai` connects to it with the official MCP SDK
(http StreamableHTTP or stdio, pooled) so the agent can call its tools.

**Be an MCP server** (server): `mod-ai` mounts **`POST /mcp`** — a stateless
StreamableHTTP JSON-RPC endpoint that exposes your `boundary.tool` workflows to
external MCP clients (Claude Desktop, other agents). `tools/list` reads the tool
registry; `tools/call` runs the tool workflow via `ctx.invoke` — a linked
sub-run with the same validation + tracing as an agent's own tool call. Narrow
which tools are exposed by building your own route around `ai.mcp.serve`
(`config.tools`).

## Settings & keys

- **Provider keys** → the vault (admin → System → **Secrets**): store
  `OPENAI_API_KEY`, `AI_GATEWAY_API_KEY`, etc. `mod-ai` resolves them by name.
- **Default model** → admin → Settings → **AI Providers**: pick routing +
  provider + model, **Test connection**, and browse the model catalog matrix.
