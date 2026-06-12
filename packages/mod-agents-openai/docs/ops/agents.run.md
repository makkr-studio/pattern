The agent loop as one node: agent descriptor + input (+ optional history,
apiKey) in; final `output`, updated `history`, and a live `events` stream
out. Always streams; map the `events` stream to an SSE response AND a
persistence sink (`core.stream.split` upstream if you need other taps).
Interruptions surface as `approval.request` events with a `stateToken` —
resume with `agents.run.resume` into the same event log. Key resolution:
`apiKey` input → `OPENAI_API_KEY` env → vault secret of the same name.
