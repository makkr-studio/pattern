The approval pipeline's entry bookend: validate that the turn is actually
awaiting approval (`interrupted` with a stored `stateToken`), re-claim the
conversation lease for the resume run, and hand the `stateToken` + decisions to
`agents.run.resume`. The resume continues the SAME turn doc — one event log per
turn — so don't mint a new turnId. Conflict/not-interrupted is a value on the
`outcome` port; branch to a 4xx, don't throw.
