Define a model inline, right on the canvas, and wire its `model` output into any
`ai.*` op's `model` input or into `agents.agent`. The output is a plain-JSON
model reference: it carries no key, so it is safe to pass along edges.

`routing` picks the path. `gateway` (the default) goes through the Vercel AI
Gateway with a full `provider/model` id such as `openai/gpt-5.6`; `direct` uses
the provider's own package with a bare id such as `gpt-5.6`. The key is looked
up by name at run time, first in env vars and then in the unlocked vault: by
default `AI_GATEWAY_API_KEY` for the gateway, or the provider's conventional
name (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, ...) for direct. Set `credential`
to read a differently named secret.

```json
{ "id": "model", "op": "ai.model",
  "config": { "routing": "direct", "provider": "openai", "modelId": "gpt-5.6" } }
```

Wire `providerOptions` to send provider-specific settings with every call made
through this model. The shape is the AI SDK's, keyed by provider id:
`{ "openai": { "reasoningEffort": "low" } }`. Ops that take their own options
(such as `ai.image.generate`) merge theirs over these.

Inline models cover single-key providers. Azure, Bedrock, Vertex and other
providers with structured credentials need an alias: configure one in admin →
Resources → AI Providers and use `ai.alias`. Prefer `ai.alias` whenever several
workflows should share a model you may want to swap later. `modality` is a
label for display and the catalog; the consuming op decides which kind of model
it asks the provider for.
