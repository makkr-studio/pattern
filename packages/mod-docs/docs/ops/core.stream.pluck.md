Pull `config.path` (a dot/bracket path) out of every chunk and re-emit those
values as a stream (no sub-workflow, no per-chunk sub-run). Chunks where the path
is missing are dropped, so an agent's frames like `{ delta: { text } }`
interleaved with control frames become a clean text stream via path
`delta.text`. The cheap inline transform `core.stream.map` points to for token
streams: pipe it straight into a `boundary.cli.exit` `stdoutStream` or an SSE
response.
