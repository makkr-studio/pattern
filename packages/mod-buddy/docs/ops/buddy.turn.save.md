The tail of the `buddy.turn` pipeline: waits for `agents.run`'s updated
`history` and replaces the thread's messages with it (compare-and-swap,
retried). Without mod-store it is a graceful no-op — Buddy just stays
stateless. Wire `history` from agents.run and `slug` from buddy.turn.begin.
