The body of the `remember` tool: save one durable fact about the CURRENT user
(the tool sub-run inherits the chat principal) into the memory collection.
Because the agent calls it mid-turn, remembering is a visible act — the chat
UI shows the tool chip, the agent can acknowledge it in the same breath, and
the memory's `sourceRunId` receipt is the tool call's own run. Signed-in users
only; fails soft with a spoken-word error the agent can relay.
