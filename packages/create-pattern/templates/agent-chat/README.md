# {{name}}

An AI-agent chat on [Pattern](https://pattern-js.dev): the agent, its
tools and its guardrails are workflow nodes you can see and rewire.

```sh
npm run dev
```

- **Chat** → http://localhost:3000/chat: transcript UI, streaming, tool
  activity on the strand, image input, human-in-the-loop approvals
- **Admin** → http://localhost:3000/admin, the kitchen: fork the turn
  pipeline, watch every tool call as a linked sub-run, browse conversations
  in Data, manage secrets

## The API key

Give the chat a model: set a `default` alias in admin → **Resources → AI
Providers** (pick a provider, a model id, and where its key comes from, the vault
or an env var).

Keys live in the encrypted **vault**: paste one in admin → **Resources →
Secrets** (for OpenAI the conventional name is `OPENAI_API_KEY`) and it applies
on the next call, no restart. Keys kept in the vault never appear in run
samples. Prefer an env var? Define it in `.env` (copied from `.env.example`,
gitignored, loaded on boot, real env wins) and point the alias at env. The
vault's own master key (`PATTERN_VAULT_KEY`) was generated into `.env` by the
scaffolder: keep it forever, it decrypts `.pattern-data/vault.db`.

## Add a tool

A tool is a workflow: `boundary.tool` (name + JSON-Schema params) → your
graph → `boundary.tool.return`. Drop a JSON file in `workflows/` (two
examples ship in there) and the agent discovers it by itself. Set
`needsApproval: true` and the chat asks you before each call.

## What's inside

```
{{name}}/
  pattern.config.json    # mods: chat + agents + ai + store + vault + admin
  workflows/
    tool-time.json       # a minimal boundary.tool
    tool-weather.json    # a tool with validated params + an outbound fetch
  src/index.ts           # loadProject() → start()
  .env.example           # OPENAI_API_KEY, PATTERN_VAULT_KEY, CHAT_* switches
  AGENTS.md              # recipes for your coding agent (CLAUDE.md points here)
```

Every chat turn runs the `chat.turn.pipeline` workflow, visible (and forkable)
in the admin. The agent, its tools, and its guardrails are graph nodes.

## Next steps

- **Tune the agent**, **add a guardrail**, **require sign-in**, or **fork the
  turn pipeline**: `AGENTS.md` has the recipes (your coding agent reads it too).
- **The handbook** at `/docs` (add `@pattern-js/mod-docs` if you didn't): the
  *Agents & chat* chapter and the *Chat* chapter (customizing, multiple
  branded instances) go deeper.

## Grow & deploy

- **Add capabilities later**: `npx pattern add billing,vectors` (or any layer:
  auth, email, ai, agents, chat, docs…) applies them to this project additively;
  `npx pattern add` lists what is installed.
- **Ship it**: the `Dockerfile` here is ready (two volumes: `.pattern/` for the
  workflow store, `.pattern-data/` for the databases). Set `PATTERN_PUBLIC_URL`
  in production; the handbook at `/docs` → **Deploying** walks Fly.io, Railway
  and Render.
