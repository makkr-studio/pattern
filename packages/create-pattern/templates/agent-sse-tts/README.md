# {{name}}

The streaming showcase from the Pattern spec (§6): an agent's token stream split
into a live **SSE** response and concurrent **TTS** synthesis.

```bash
npm run dev
# then, to watch tokens stream in:
curl -N "localhost:3000/chat?q=hello"
```

```
request → agent(tokens: stream) → split(2) ─┬─▶ SSE response body
                                             └─▶ TTS synthesis
```

Both branches run concurrently with backpressure. Replace `app.agent` with a real
LLM (return a `ReadableStream<string>` of tokens) and `app.tts` with a real
synthesizer — the workflow graph doesn't change.
