The persistence tap on the agent's event stream: coalesces text deltas
(~150ms), appends to the turn doc, renews the lease per flush, releases it at
the terminal event, and broadcasts `chat.turn.updated` notifications. ALWAYS
writes a terminal status — if the producer dies mid-stream, the error becomes
turn content. Control-gate it on the ok path (skip on conflict).
