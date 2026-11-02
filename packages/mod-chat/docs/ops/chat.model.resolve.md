Picks the model for one turn, and is the only node feeding the
`agents.agent` node's `model` input in the turn pipeline. Precedence: the per-turn `alias` (the
switcher's choice, from the request body's `model`) wins, then the
`fallback` (the pipeline's `ai.model` pin, when the agent is configured with
one), then the app default, which the op signals by emitting `null`: the
agent then carries no model and the run uses the default.

It fails soft: an unknown alias, a non-language alias, or a missing mod-ai
all fall through to `fallback` without an error, so a stale choice in a
browser's local storage never breaks a turn. When you fork the pipeline to
pin a model for one namespace, wire your `ai.model` into `fallback` and keep
this node, or the switcher stops having any effect. The approval pipeline
wires its pin straight into the agent, so a resumed turn runs on the pin or
the default. Pairs with `chat.models.list`.
