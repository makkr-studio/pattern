# example: agent-sse-tts

A runnable, workspace-wired copy of the streaming showcase (spec §6). Unlike the
scaffolder template (which depends on published packages), this one links to the
local `@pattern/*` packages, so you can run it straight from the monorepo.

```bash
pnpm build                                   # build @pattern/core + runtime-node
pnpm --filter example-agent-sse-tts dev      # start on :3000 (or PORT=...)

# in another terminal — watch tokens stream in:
curl -N "http://localhost:3000/chat?q=hello%20pattern"
```

```
request → app.agent(tokens: stream) → split(2) ─┬─▶ SSE response body
                                                 └─▶ app.tts (stdout)
```

Both branches run concurrently with backpressure. Swap `app.agent` for a real LLM
(return a `ReadableStream<string>` of tokens) and `app.tts` for a synthesizer —
the workflow graph stays the same. Source: [`src/index.ts`](./src/index.ts).
