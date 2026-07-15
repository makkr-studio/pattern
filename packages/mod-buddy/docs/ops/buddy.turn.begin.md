The head of the `buddy.turn` pipeline: takes the dock's `{ message, slug?,
doc?, runId?, turnId? }`, loads the caller's thread for that workflow (empty
without mod-store), assembles the instructions (Buddy's system prompt + the
open canvas document + the run under debug), and resolves the model — the
`buddy` language alias when you've defined one, else the agent default.
Outputs wire straight into `agents.agent`/`agents.run`. Privileged: gate the
trigger with the `admin` scope.
