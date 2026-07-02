# @pattern-js/mod-agents

[pattern-js.dev](https://pattern-js.dev) · [npm](https://www.npmjs.com/package/@pattern-js/mod-agents)

The **neutral** agents layer for [Pattern](../../README.md): plain-JSON
agent/tool/guardrail descriptors, the modality-agnostic turn event protocol, and
the native agent run loop, with **no provider SDK**. It calls a model through a
seam that `@pattern-js/mod-ai` implements; apps consume the events. Each layer is
decoupled.

```bash
npm install @pattern-js/mod-agents
```

## When to use

Install it whenever you want agents in your app, always alongside a model
provider. It contributes the `boundary.tool` pair, the toolset/guardrail ops, the
live tool registry (`AGENTS_SERVICE`), and **the native agent run loop**; the loop
needs a model to run. Pair it with `@pattern-js/mod-ai` (the model provider: it
implements the neutral model seam this loop calls and adds the `ai.model` node +
capability ops).

**When not:** a single model call with no tools, no agent loop, and no streaming
turn events. An `ai.text.generate` op straight from the canvas is lighter than
the agents stack.

## Prerequisites

Always ship it with `@pattern-js/mod-ai` (the model provider). Usually also
`@pattern-js/mod-store` (history + blobs) and `@pattern-js/mod-vault` (provider keys).

## Config

The agents layer always ships paired with the model provider. Add both as strings
in `pattern.config.json`:

```jsonc
{ "mods": ["@pattern-js/mod-agents", "@pattern-js/mod-ai"] }
```

For options, export a local wrapper mod that calls the `agentsMod({...})` factory.

Full documentation: the **Agents (contracts)** chapter at `/docs` (served by
`@pattern-js/mod-docs`), or [the source](docs/index.md).
