# {{name}}

Build **agentic workflows** on [Pattern](https://github.com/pattern): graphs
that wire an agent (`agents.agent`) into a runner (`agents.run`), with tools
that are themselves workflows. No chat UI — you build and run them in the
visual editor, and every tool call is a traced sub-run.

```sh
npm run dev
```

- **Admin** → http://localhost:3000/admin — editor, run traces, versioned
  workflow store, data browser, secrets.
- **Example** → `POST /ask` runs an agent that can call the `get_time` tool:

  ```sh
  curl -XPOST localhost:3000/ask -H 'content-type: application/json' \
    -d '{"question":"what time is it in ISO?"}'
  ```

## The API key

Set `OPENAI_API_KEY` in `.env` (copied from `.env.example`, gitignored, loaded
on boot — real env wins). Or store it encrypted on the admin **Secrets** page
(System → Secrets) as a secret named `OPENAI_API_KEY`; the agent ops find it
there with no wiring. The vault's master key (`PATTERN_VAULT_KEY`) lives in
`.env` — generate it ONCE with `openssl rand -base64 32`.

## The shape of an agentic workflow

`workflows/agent-answer.json` is the canonical example:

```
boundary.http.request → core.object.get (question) ┐
agents.tools.workflows (toolset) → agents.agent → agents.run → boundary.http.response
```

`agents.tools.workflows` collects every `boundary.tool` workflow (like
`tool-time.json`) into a toolset; `agents.agent` is a value you wire into
`agents.run`.

## What's inside

```
{{name}}/
  pattern.config.json    # mods: admin + agents + agents-openai + store + vault
  workflows/
    agent-answer.json    # POST /ask — the agentic workflow (canonical shape)
    tool-time.json       # a boundary.tool the agent can call
  src/index.ts           # loadProject() → start()
  .env.example           # OPENAI_API_KEY, PATTERN_VAULT_KEY
  AGENTS.md              # recipes for your coding agent (CLAUDE.md points here)
```

## Next steps

- **Add a tool** — drop a `boundary.tool` → … → `boundary.tool.return` workflow
  into `workflows/`; the agent discovers it automatically.
- **Add a guardrail**, **stream the run** over SSE, or run it from the editor —
  `AGENTS.md` has the recipes (your coding agent reads it too).
- **The handbook** at `/docs` (add `@pattern/mod-docs` if you didn't): the
  *Agents & chat* and *Designing your API* guides go deeper.
