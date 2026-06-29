One conversation, scope-checked against `user`/`device`. Returns a `not_found`
httpOutcome (not a throw) when the id is missing OR not the caller's. The two
are deliberately indistinguishable, so don't surface "exists but forbidden". For
the turn event logs that drive replay, use `chat.turns.list`.
