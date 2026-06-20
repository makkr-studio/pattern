# @pattern-js/mod-agents-openai

The OpenAI provider for [Pattern](../../README.md)'s agents layer — it reifies
the neutral `@pattern-js/mod-agents` descriptors with the `@openai/agents` SDK:
streaming runs, tools (workflow / MCP / op), guardrails, handoffs, history
compaction, and human-in-the-loop approvals. `agents.agent` builds a plain-JSON
descriptor; `agents.run` reifies and runs it.

```bash
npm install @pattern-js/mod-agents-openai
```

## When to use

Use it when your provider is OpenAI (or anything `ModelProvider`-compatible) and
there's an actual agent — tools, handoffs, a live transcript. It owns the
`agents.*` run ops; the neutral mod owns the `boundary.tool` pair and toolset
ops.

**When not:** a one-shot completion with no tools, loop, or streaming events — a
plain model-call op is lighter.

## Prerequisites

- **`@pattern-js/mod-agents`** — required; the mod throws on startup without it.
- An `OPENAI_API_KEY` — resolved from a wired `apiKey` input, the environment
  (`loadProject` auto-loads a `.env`), or a `@pattern-js/mod-vault` secret *named*
  `OPENAI_API_KEY`. Missing key is a loud pre-flight failure.

## Config

The provider needs the contracts — add both as strings in `pattern.config.json`:

```jsonc
{ "mods": ["@pattern-js/mod-agents", "@pattern-js/mod-agents-openai"] }
```

For options, export a local wrapper mod that calls the `agentsOpenAIMod({...})`
factory.

Full documentation: the **Agents (OpenAI provider)** chapter at `/docs` (served
by `@pattern-js/mod-docs`), or [the source](docs/index.md).
