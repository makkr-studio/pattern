# Agents (OpenAI provider)

`@pattern/mod-agents-openai` reifies the neutral agent descriptors with the
`@openai/agents` SDK: streaming runs, tools (workflow/MCP/op), guardrails,
handoffs, history compaction, human-in-the-loop approvals, and realtime
key minting (the voice round's foundation).

## The API key

`agents.run` resolves its key in order: explicit `apiKey` input →
`OPENAI_API_KEY` from the environment (a `.env` next to
`pattern.config.json` is auto-loaded) → **a vault secret named
`OPENAI_API_KEY`** (admin → System → Secrets). Storing it in the vault Just
Works, no wiring.

## Key behaviors

- Runs always stream internally; events map to the neutral turn protocol.
- Tool calls execute as linked sub-runs via the engine — inspectable.
- An interruption (tool `needsApproval`) emits `approval.request` with an
  opaque resume token; `agents.run.resume` continues the SAME turn.
- `MODEL_PROVIDER_SERVICE` is the test seam: inject a scripted model and the
  whole stack runs without an API key (the agent-chat demo does this).
