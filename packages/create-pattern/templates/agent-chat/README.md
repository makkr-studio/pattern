# {{name}}

An AI-agent chat on [Pattern](https://github.com/pattern) — the agent, its
tools and its guardrails are workflow nodes you can see and rewire.

```sh
npm run dev
```

- **Chat** → http://localhost:3000/chat — transcript UI, streaming, tool
  activity on the strand, image input, human-in-the-loop approvals
- **Admin** → http://localhost:3000/admin — the kitchen: fork the turn
  pipeline, watch every tool call as a linked sub-run, browse conversations
  in Data, manage secrets

## The API key

Set `OPENAI_API_KEY` in your environment — or open the admin's **Secrets**
page (System → Secrets), store it encrypted, and wire a `vault.read` node
into the pipeline's `apiKey` input. Vault values never appear in run samples.

## Add a tool

A tool is a workflow: `boundary.tool` (name + JSON-Schema params) → your
graph → `boundary.tool.return`. Drop a JSON file in `workflows/` (two
examples ship in there) and the agent discovers it by itself. Set
`needsApproval: true` and the chat asks you before each call.

See `AGENTS.md` for the full recipes (your coding agent reads it too).
