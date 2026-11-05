Structured output that arrives in pieces. Same inputs as `ai.object.generate`
(`model`, `prompt` or `messages`, optional `system`, a JSON Schema on
`schema`). Each item on `partialStream` is the object so far, growing as fields
complete; `object` and `usage` settle at the end with the final value.

Use it when a person watches the result form: a card that fills in field by
field, a list that grows as items are produced. Partials are snapshots of the
whole object, so a consumer can render the latest one and drop the rest.
Required fields may be missing in early partials; validate on `object`, which
settles once the model is done. When only the final object matters, use
`ai.object.generate`.
