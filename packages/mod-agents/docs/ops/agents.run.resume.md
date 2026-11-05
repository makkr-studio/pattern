Continue a turn that paused for human approval. When a tool marked
`needsApproval` is requested, `agents.run` emits one `approval.request` per
pending call (`interruption: { id, toolName, args }` plus a `stateToken`) and
ends with `stopReason: "interrupted"`. Store the `stateToken`, show the
requests to a person, then wire the same `agent`, the `stateToken`, and
`decisions` (`[{ id, approved }]`, or a single object) into this node.

Approved calls run now; declined ones go back to the model as "The user
declined this tool call." The turn then continues exactly like `agents.run`,
with the same outputs, and may pause again. Input guardrails do not re-run on
resume. Send one decision per pending call; a decision whose `id` matches no
pending call ends the turn with an `error` event.

The token is the saved conversation and pending calls as JSON, so keep it
server-side and accept only the decisions from the client, the way
`chat.approval.begin` does. Wire the original `turnId` to keep one event log
per turn. The resumed loop uses the default limit of 10 model steps.
