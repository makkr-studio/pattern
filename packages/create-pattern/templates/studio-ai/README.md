# {{name}}

Build **AI workflows** on [Pattern](https://pattern-js.dev):
graphs that call AI capability ops directly (text, structured output,
embeddings, image, speech, transcription, video) across any provider. No agent
loop; you build and run them in the visual editor, and every run is traced.

```sh
npm run dev
```

- **Admin** → http://localhost:3000/admin: editor, run traces, versioned
  workflow store, data browser, secrets, and **Resources → AI Providers**.
- **Example** → `POST /summarize` runs `ai.text.generate` on your default model:

  ```sh
  curl -XPOST localhost:3000/summarize -H 'content-type: application/json' \
    -d '{"text":"<a few paragraphs to condense>"}'
  ```

## Configure a model (alias)

Models come from a named **alias**. Open admin → **Resources → AI Providers**,
create a `default` alias (pick a provider, a model id, and the key it uses,
from the vault or an env var), and the example works.

Keys live in the encrypted **vault**: paste one in admin → **Resources →
Secrets** (for OpenAI the conventional name is `OPENAI_API_KEY`) and it applies
on the next call, no restart. Keys kept in the vault never appear in run
samples. Prefer an env var? Define it in `.env` (copied from `.env.example`,
gitignored, loaded on boot, real env wins) and point the alias at env. The
vault's own master key (`PATTERN_VAULT_KEY`) was generated into `.env` by the
scaffolder: keep it forever, it decrypts `.pattern-data/vault.db`.

## The shape of an AI workflow

`workflows/summarize.json` is the canonical example:

```
boundary.http.request → core.string.template (build the prompt) ┐
ai.alias (the model) ──────────────────────────────────────────→ ai.text.generate → core.object.build → boundary.http.response
```

`ai.alias` resolves a model you configured in Settings; wire its `model` output
into any `ai.*` op. Swap `ai.text.generate` for `ai.image.generate`,
`ai.object.generate`, `ai.transcribe`, … to build other capabilities.

## What's inside

```
{{name}}/
  pattern.config.json    # mods: admin + ai + store + vault
  workflows/
    summarize.json       # POST /summarize, the AI workflow (canonical shape)
  src/index.ts           # loadProject() → start()
  .env.example           # OPENAI_API_KEY, PATTERN_VAULT_KEY
  AGENTS.md              # recipes for your coding agent (CLAUDE.md points here)
```

## Next steps

- **Try another modality**: swap in `ai.image.generate`, `ai.object.generate`
  (structured extraction with a JSON Schema), `ai.embed`, or `ai.transcribe`.
- **Want agents?** Add `@pattern-js/mod-agents` for the `agents.agent` /
  `agents.run` loop (or scaffold the *Studio + AI + Agents* pack).
- **The handbook** at `/docs` (add `@pattern-js/mod-docs` if you didn't) goes
  deeper on ops and designing your API.

## Grow & deploy

- **Add capabilities later**: `npx pattern add billing,vectors` (or any layer:
  auth, email, ai, agents, chat, docs…) applies them to this project additively;
  `npx pattern add` lists what is installed.
- **Ship it**: the `Dockerfile` here is ready (two volumes: `.pattern/` for the
  workflow store, `.pattern-data/` for the databases). Set `PATTERN_PUBLIC_URL`
  in production; the handbook at `/docs` → **Deploying** walks Fly.io, Railway
  and Render.
