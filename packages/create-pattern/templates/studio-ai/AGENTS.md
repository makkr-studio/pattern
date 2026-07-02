# Agent guide: {{name}} (Pattern · Studio + AI modpack)

You are working in a **Pattern** project for building **AI workflows**: graphs
that call AI capability ops directly (no agent loop). The visual admin at
`/admin` is the editor + run tracer. Use this stack when the task is "text in,
text/image/audio/embedding out": summaries, classification, extraction, image
generation, transcription, TTS. (If you need an autonomous agent that calls
tools in a loop, that's the **mod-agents** layer, a different modpack.)

## Ground rules

1. **Never guess op names or ports.** Ground truth is one command away:
   - `npx pattern ops ai`: every AI op (text, object, embed, image, speech, transcribe, video)
   - `npx pattern ops ai.text.generate`: full ports + config for any op
   - `npx pattern ops`: every op (core + this project's mods)
2. **Validate every workflow JSON you touch:** `npx pattern validate <file>`,
   and `npx pattern graph <file>` to see the graph in the terminal.
3. **Models come from an alias.** Configure one in admin → Settings → AI
   Providers (a provider + model id + the key it uses, from the vault or an env
   var), then resolve it with an `ai.alias` node (`config { alias }`, output
   `model` is a *value* you wire into any `ai.*` op's `model` input). The
   `default` alias is the fallback. Or define a model inline with `ai.model`
   (`config { routing, provider, modelId }`); it resolves the provider's
   conventional key (e.g. `OPENAI_API_KEY` for OpenAI) from `.env` (loaded on
   boot, real env wins) or a vault secret of that name (admin → System → Secrets).
   `PATTERN_VAULT_KEY` (the vault master key) lives in `.env`.
4. Don't edit `./.pattern` by hand (admin-versioned workflows, committed);
   `./.pattern-data` is runtime data (sqlite, blobs, secrets) and is gitignored.

## The AI ops (60 seconds)

- **`ai.alias`**: `config { alias }`; output `model` (a value). The model handle.
- **`ai.text.generate`** / **`ai.text.stream`**: `prompt` XOR `messages` (+ `system`); out `text`, `usage`. Stream emits tokens live.
- **`ai.object.generate`**: give a JSON-Schema `schema`; out a typed `object`. Structured extraction.
- **`ai.embed`** / **`ai.embed.many`**: text → vector(s) (use an embedding alias).
- **`ai.image.generate`**: `prompt` (+ optional input `image` for image-to-image, provider-dependent) → raw media (`{ bytes, mime, kind }`). The generation ops **don't save**; wire the output into `store.blob.put` to persist it (its `ref` output is a `MediaRef` served at `/store/blobs/:id`).
- **`ai.speech.generate`** (TTS), **`ai.video.generate`**: likewise output raw media; persist with an explicit `store.blob.put` node. **`ai.transcribe`** (STT) takes audio in, returns `text` (+ segments).

## Recipe: an AI route

See `workflows/summarize.json`. The shape (expose a capability op over HTTP):

```
boundary.http.request → core.string.template (build the prompt) ┐
ai.alias (the model) ───────────────────────────────────────────→ ai.text.generate → core.object.build → boundary.http.response
```

Keep HTTP concerns on the boundary (method/path/validation/auth); wire the
request into the op's inputs and the op's output into the response body. Want it
editor/CLI-only instead of HTTP? Swap the `boundary.http.request`/`response`
pair for `boundary.manual`/`boundary.return` and run it from the admin's Runs
view or `engine.run("<id>", { input })`.

## Serve a custom frontend

A standalone user-facing SPA is just a workflow: register your built assets as a
named filesystem in a mod's `setup` (`provideFilesystem(engine, "my-app",
localFs("./app/dist"))`), then declare the app trio `boundary.http.app` →
`core.app.static` (`filesystem: "my-app"`, `spaFallback: "index.html"`) →
`boundary.http.app.serve`. `filesystem` is the registered **name**, not a path;
the app resolves once at registration (rebuilt SPA → restart; in dev run Vite and
proxy `/api` + `/auth` to the backend). No stack is imposed, but the admin is
built with React, Tailwind, motion.dev (the `motion` package) and lucide: a
tested starting point if you have no preference.

## Hybrid execution

This project ships a small worker pool (`workers` in `pattern.config.json`), so
the admin's Process page reads **hybrid**. Set a workflow's `offload` flag
(editor → gear, or `"offload": true`) to run a compute-heavy flow on that pool
instead of the host event loop; remove the `workers` field to go back to inline.

## Where things live

- `workflows/`: file workflows (your AI flows); editable, committed
- `./.pattern`: admin-versioned workflows (committed)
- `./.pattern-data`: sqlite + blobs (generated media, secrets); gitignored
