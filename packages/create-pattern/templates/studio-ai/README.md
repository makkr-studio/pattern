# {{name}}

Build **AI workflows** on [Pattern](https://pattern-js.dev):
graphs that call AI capability ops directly (text, structured output,
embeddings, image, speech, transcription, video) across any provider. No agent
loop; you build and run them in the visual editor, and every run is traced.

```sh
npm run dev
```

- **Admin** → http://localhost:3000/admin: editor, run traces, versioned
  workflow store, data browser, secrets, and **Settings → AI Providers**.
- **Example** → `POST /summarize` runs `ai.text.generate` on your default model:

  ```sh
  curl -XPOST localhost:3000/summarize -H 'content-type: application/json' \
    -d '{"text":"<a few paragraphs to condense>"}'
  ```

## Configure a model (alias)

Models come from a named **alias**. Open admin → **Settings → AI Providers**,
create a `default` alias (pick a provider, a model id, and the key it uses,
from the vault or an env var), and the example works. For an env-sourced key,
define it in `.env` (copied from `.env.example`, gitignored, loaded on boot, real
env wins; for OpenAI the name is `OPENAI_API_KEY`), or store it on the admin
**Secrets** page. The vault's master key
(`PATTERN_VAULT_KEY`) lives in `.env`; generate it ONCE with
`openssl rand -base64 32`.

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
