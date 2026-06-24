# @pattern-js/mod-agents

The **neutral** agents contracts layer for [Pattern](../../README.md) — plain-JSON
agent/tool/guardrail descriptors and the modality-agnostic turn event protocol,
with **no SDK dependency**. Provider mods reify the descriptors; apps consume the
events. Neither has to know about the other.

```bash
npm install @pattern-js/mod-agents
```

## When to use

Install it whenever you want agents in your app — but never *alone*. It
contributes the `boundary.tool` pair, the toolset/guardrail ops, and the live
tool registry (`AGENTS_SERVICE`), **and the native agent run loop** — but without
a model provider it has nothing to run. Pair it with `@pattern-js/mod-ai` (the
model provider; it implements the neutral model seam this loop calls and adds the
`ai.model` node + capability ops).

**When not:** a single model call with no tools, no agent loop, and no streaming
turn events — an `ai.text.generate` op straight from the canvas is lighter than
the agents stack.

## Prerequisites

Always ship it with `@pattern-js/mod-ai` (the model provider). Usually also
`@pattern-js/mod-store` (history + blobs) and `@pattern-js/mod-vault` (provider keys).

## Config

The contracts always ship paired with the model provider — add both as strings in
`pattern.config.json`:

```jsonc
{ "mods": ["@pattern-js/mod-agents", "@pattern-js/mod-ai"] }
```

For options, export a local wrapper mod that calls the `agentsMod({...})` factory.

Full documentation: the **Agents (contracts)** chapter at `/docs` (served by
`@pattern-js/mod-docs`), or [the source](docs/index.md).
