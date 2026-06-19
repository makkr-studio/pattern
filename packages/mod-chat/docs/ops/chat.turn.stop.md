Cancel a running turn: aborts the provider's turn (the live streaming handle)
and falls back to `cancelRun` for any non-streaming remainder. It does NOT write
the terminal state — the run's `chat.events.sink` does that as the abort
propagates, so the turn settles to `cancelled` on its own. Returns `cancelled:
false` harmlessly if nothing was live.
