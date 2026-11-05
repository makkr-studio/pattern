Run one agent turn. Wire `agent` (from `agents.agent`) and `input`: a string,
an array of message parts (`text` and `image_ref` with a mod-store blob id), or
an array of neutral messages. Optional `history` is the conversation so far;
the new input is appended after it.

`events` streams the turn event protocol (`text.delta`, `text.done`,
`tool.activity`, `approval.request`, `error`) and always ends with `done`.
Wire it into `boundary.http.response`'s `stream` port or `chat.events.sink`.
`output` (the final text), `history`, `stopReason` (`complete`, `interrupted`,
`error`, `cancelled`), `stateToken` and `usage` (tokens summed over the turn)
settle when the turn ends.

The loop calls the model, runs requested tools (workflow tools as linked
sub-runs you can open in the Runs page), feeds results back, and repeats up to
config `maxTurns` model steps (default 10); going past it ends the turn with a
`max_turns` error event. A tool that throws becomes an error result the model
reads, and the turn continues. Problems during the turn (a tripped guardrail, a
provider error) arrive as `error` events with `stopReason: "error"`; only
pre-flight problems (no model provider installed, an `input` of the wrong
shape) fail the node itself.

On `error` and `cancelled`, `history` hands back the history the turn started
from, so saving it unconditionally keeps the conversation intact (the failed
user message is not added). The turn registers
under `turnId` (default: the run id) so `AGENTS_SERVICE.abortTurn` can stop it
while the stream is still flowing; `chat.turn.stop` works this way.
