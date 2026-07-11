Per-user memory recall, sitting in the turn pipeline in front of the agent's
`instructions` port: a hybrid search over the memory collection, pre-scan
pruned to THIS user (`filter: { userId }` — one user's memories never rank
against another's), appends a "things you remember about this user" block to
the system prompt. Fails soft by design: guests, a missing mod-vectors, an
empty collection, or ANY retrieval error fall back to the plain instructions —
memory may enrich a turn, never break one. Config `{ fallback }` carries the
base instructions used when nothing is wired in.
