Keep a long conversation inside the model's context window. Wire `history`
(neutral messages, as `agents.run` produces them); when it holds more than
config `threshold` items (default 60), everything except the last `keepRecent`
items (default 20) is summarized by a model into a single message that starts
with `[Summary of the earlier conversation]`. Outputs the new `history` and
`compacted` (`false` when the history was short enough to pass through
untouched).

Place it between the store read and `agents.run`, and save the compacted
history back so the summary replaces the old items for good. Being a visible
node, each compaction shows in the run trace. Wire a `model` (a small, cheap
one is usually enough) or leave it unwired to use the `default` alias. The
summary call emits an `ai.usage` event like any other model call.
