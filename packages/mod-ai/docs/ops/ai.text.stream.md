The streaming twin of `ai.text.generate`: same inputs (`model`, `prompt` or
`messages`, optional `system`, config `maxOutputTokens`), with the reply flowing
token by token on the `textStream` stream port while `text`, `usage` and
`finishReason` settle once the model finishes.

Wire `textStream` into `boundary.http.response`'s `stream` port (`mode: "sse"`)
to show the answer as it is written, and wire `text` to whatever must run on
the final result, such as a `store.put` that saves the reply. Nodes reading
`text` wait for the end of the stream; nodes reading `textStream` start with
the first token. Each chunk is a plain string delta.

For tool use and the turn event protocol, use `agents.run`.
