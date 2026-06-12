Builds an agent DESCRIPTOR (plain JSON — instructions, model, tools,
guardrails, handoffs). No SDK work happens here; the descriptor reifies
inside `agents.run`. Config carries the common knobs; wire `tools` from
`agents.tools.workflows` and friends.
