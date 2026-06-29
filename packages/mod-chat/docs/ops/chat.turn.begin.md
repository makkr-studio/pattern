The turn pipeline's entry bookkeeping: scope check (user or device cookie),
the conversation LEASE (second concurrent turn → the 409 path with the
active turn id), and the turn doc that will persist the event log. Mint the
turnId client-side to make Stop race-free. Conflict is a value on the
`conflict` path. Branch to a 409 response, don't throw.
