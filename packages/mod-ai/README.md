# @pattern-js/mod-ai

The AI capability layer for [Pattern](../../README.md): **text, structured
output, embeddings, image, speech (TTS), transcription (STT), and video**
generation across **any provider**, directly or through the Vercel AI Gateway. It
is also the model provider that powers `@pattern-js/mod-agents`, so agents call
models through it.

**Links:** [pattern-js.dev](https://pattern-js.dev) · [npm](https://www.npmjs.com/package/@pattern-js/mod-ai)

```bash
npm install @pattern-js/mod-ai
```

## When to use

Install it whenever a workflow needs a model: a one-shot `ai.text.generate` from
the canvas, structured output, embeddings for search, or generated media. It is
the only mod that imports the [Vercel AI SDK](https://ai-sdk.dev), so every
provider quirk, streaming detail, and the MCP client stay behind one seam.

Pair it with `@pattern-js/mod-agents` for agents (mod-ai implements the model seam
the agent loop calls) and with `@pattern-js/mod-store` to persist generated media
(wire a generation op into `store.blob.put`; the generation ops stay
storage-agnostic). Provider keys live in `@pattern-js/mod-vault`.

## Pick a model

Two ops produce a model reference you wire into any `ai.*` op or
`agents.agent.model`:

- **`ai.model`** defines a model inline (`routing: "direct" | "gateway"`,
  `provider`, `modelId`).
- **`ai.alias`** resolves a model configured in admin → Settings → **AI
  Providers** by name. Re-point an alias there and every workflow using it
  re-targets at run time.

Agents and chat fall back to the **`default`** alias when no model is wired.

## Providers

mod-ai bundles no provider. The Vercel AI Gateway ships inside `ai` and works with
one key and `provider/model` ids. Each direct provider is an optional peer that
mod-ai lazy-loads when an alias uses it:

```bash
npm i @ai-sdk/anthropic        # then point an alias at the "anthropic" provider
```

`npm create pattern` offers a provider multi-select when a modpack uses mod-ai, so
a scaffold installs exactly the ones you pick.

## Config

The bare-string install works once a model is configured:

```jsonc
{ "mods": ["@pattern-js/mod-ai"] }
```

Set a default model and provider keys in admin → Settings → **AI Providers**.

Full documentation: the **AI capabilities** chapter at `/docs` (served by
`@pattern-js/mod-docs`), or [the source](docs/index.md).
