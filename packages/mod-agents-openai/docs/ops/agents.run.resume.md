Resume an interrupted (human-in-the-loop) run: the `stateToken` from an
`approval.request` event + the approve/reject `decisions` continue the SAME
turn into the same event log. Outputs mirror `agents.run` (events stream,
output, updated history) plus a fresh `stateToken` if it interrupts again.
This is how the chat's Approve/Deny buttons drive the agent forward.
