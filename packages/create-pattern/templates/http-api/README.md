# {{name}}

An HTTP API built from [Pattern](https://github.com/) workflows.

```bash
npm run dev          # hot-reload server (pattern dev)
# then:
curl localhost:3000/hello/world
curl -XPOST localhost:3000/echo -H 'content-type: application/json' -d '{"hi":1}'
```

Routes live in `src/index.ts`. Each route binds a request to a
`boundary.http.request` trigger and writes a `boundary.http.response`. Response
`mode` can be `buffered`, `sse`, or `chunked` — see the `agent-sse-tts` template
for streaming.
