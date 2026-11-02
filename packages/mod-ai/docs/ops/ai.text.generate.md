One model call, one settled answer: `text`, plus `usage` (input, output and
total tokens when the provider reports them) and `finishReason`. Use it for
summaries, classification, rewriting and any step where the next node needs the
whole text before it can run.

Give it either `prompt` (a single user message) or `messages` (neutral chat
messages, the same shape `agents.run` keeps as history); when both are wired,
`messages` wins. `system` sets the instructions. Config `maxOutputTokens` caps
the reply length.

Wire `model` from `ai.model` or `ai.alias`. The call is metered: each one emits
an `ai.usage` event on the bus. When a person is waiting on the answer, use
`ai.text.stream` instead; when you need JSON with a known shape, use
`ai.object.generate`. If the model should call tools, reach for `agents.run`.
