Define an agent as a plain-JSON value and wire its `agent` output into
`agents.run`, into another agent's `handoffs`, or into `agents.run.resume`. The
node does no model work; it only assembles the descriptor.

Config `name` and `instructions` (the system prompt) are the defaults, and the
`name` / `instructions` inputs override them when wired, so a pipeline can vary
the agent per request (chat swaps in spoken-style instructions for voice mode
this way). Wire `model` from `ai.model` or `ai.alias`; leave it unwired and the
run uses the `default` alias. `tools` takes a toolset (`agents.tools.workflows`,
`agents.mcp.client`, `agents.tools.ops`, or `agents.tools.merge` of several),
`guardrails` one or more `agents.guardrail` values.

`handoffs` takes one or more other agents. Each becomes a tool named
`transfer_to_<name>` that the model can call to pass the conversation over; set
`handoffDescription` on the target agent to tell the model when to pick it.
