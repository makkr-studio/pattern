# {{name}}

The canonical [Pattern](https://github.com/) streaming workflow: an agent's
token stream fanned out to two consumers running at different speeds.

```
agent.tokens ──▶ core.stream.split ──▶ SSE response        (tokens, live)
                                  └──▶ accumulate ──▶ agent.tts  (full text)
```

```bash
npm run dev
# then watch the tokens flow:
curl -N 'http://localhost:3000/chat?prompt=hello'
```

```
{{name}}/
  pattern.config.json   # mods to load, workflows dir
  mods/
    agent.mjs           # `agent.tokens` (mock LLM) + `agent.tts` (mock TTS)
  workflows/
    chat.json           # GET /chat — the whole pipeline, declared as data
  src/index.ts          # loadProject() → start()
```

The browser receives Server-Sent Events as the agent produces tokens — while
`core.stream.accumulate` (a BARRIER) waits for the complete reply and hands it
to the TTS op once. One producer, two consumption speeds, zero plumbing code.

**Make it real.** Both app ops are mock single-function swaps in
`mods/agent.mjs`:

- `agent.tokens` → call a real model's streaming API (put the key in your env
  and reference it as `{ "$env": "ANTHROPIC_API_KEY" }` in config — env refs
  resolve at registration and are treated as secrets).
- `agent.tts` → call a real synthesis API with the accumulated text.

Inspect the graph:

```bash
npx pattern graph workflows/chat.json
```
