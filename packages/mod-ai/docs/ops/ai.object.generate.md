Ask a model for JSON that matches a schema. Wire a JSON Schema into `schema`
and the parsed result comes out on `object`, with `usage` beside it. Use it for
extraction (fields out of an email or a document), classification into a fixed
set of labels, or any step whose output another node reads by field.

Inputs mirror `ai.text.generate`: `model`, `prompt` or `messages`, optional
`system`. The schema can be built upstream (for example from a form definition)
because it is a wired value.

```json
{ "type": "object",
  "properties": { "intent": { "enum": ["refund", "question", "complaint"] },
                  "orderId": { "type": "string" } },
  "required": ["intent"] }
```

Keep schemas small and describe fields in `description` keys: the model reads
them. Follow with `core.object.get` to pull single fields, or use
`ai.object.stream` when a UI should fill in as the object arrives.
