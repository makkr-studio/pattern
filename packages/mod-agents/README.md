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
tool registry (`AGENTS_SERVICE`); it does **not** run an agent. Pair it with a
provider (`@pattern-js/mod-agents-openai`) that reifies the descriptors and emits
the turn events.

**When not:** a single model call with no tools, no agent loop, and no streaming
turn events — a provider op straight from the canvas is lighter than the agents
stack.

## Prerequisites

Always ship it with a provider. Usually also `@pattern-js/mod-store` (history +
blobs) and `@pattern-js/mod-vault` (the API key).

## Config

The contracts always ship paired with a provider — add both as strings in
`pattern.config.json`:

```jsonc
{ "mods": ["@pattern-js/mod-agents", "@pattern-js/mod-agents-openai"] }
```

For options, export a local wrapper mod that calls the `agentsMod({...})` factory.

Full documentation: the **Agents (contracts)** chapter at `/docs` (served by
`@pattern-js/mod-docs`), or [the source](docs/index.md).
